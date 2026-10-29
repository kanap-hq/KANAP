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

// The contract history (lot 2, linked records) on the migrated database: its own rows and the
// renewal markers in words, every child kind through the real writer (so the payload rules and
// the task rule fill `parent_*`), the link sets read by `record_id`, the references named only
// with the reader's modules, and the access rules: 403 without the contracts module, 404 for an
// unknown, foreign or out-of-scope contract. A person limited by data access reads a contract of
// their scope with the budget lines outside it counted, never named.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const CONTRACT_ONLY: Record<string, Level> = { contracts: 'reader' };
const ALL_MODULES: Record<string, Level> = {
  contracts: 'reader', budget: 'reader', applications: 'reader', infrastructure: 'reader', contacts: 'reader',
  companies: 'reader', suppliers: 'reader', cost_centers: 'reader', tasks: 'reader',
};
const LIMITED_MODULES: Record<string, Level> = { contracts: 'reader', budget: 'reader' };

type Seeded = {
  data: HistorySeed;
  task: string;
  excludedRow: string;
  allReader: Person;
  contractReader: Person;
  noModules: Person;
  limited: Person;
  throughLine: Person;
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
    return await new RecordHistoryService().list(ctx, 'contracts', id, { limit: '100' });
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
  const contractReader = await seedPerson(runner, data.tenantId, { first: 'Cora', last: 'Contracts' }, CONTRACT_ONLY);
  const noModules = await seedPerson(runner, data.tenantId, { first: 'Nino', last: 'None' }, { budget: 'reader' });
  const limited = await seedPerson(
    runner,
    data.tenantId,
    { first: 'Lila', last: 'Limited' },
    LIMITED_MODULES,
    { mode: 'limited', nodeCompanyId: data.companyA },
  );
  // Limited to company B: reads contract A only through a line of company B linked to it.
  const throughLine = await seedPerson(
    runner,
    data.tenantId,
    { first: 'Bea', last: 'Beta' },
    LIMITED_MODULES,
    { mode: 'limited', nodeCompanyId: data.companyB },
  );
  await runner.query(
    `INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`,
    [data.tenantId, data.contractA, data.hiddenLine],
  );
  const contract = data.contractA;
  const [stored] = await runner.query(`SELECT to_jsonb(c) AS row FROM contracts c WHERE c.id = $1`, [contract]);
  const row = stored.row as Record<string, unknown>;
  const by = { userId: allReader.id };

  await audit(runner, { table: 'contracts', recordId: contract, action: 'create', after: row, ...by });
  await audit(runner, {
    table: 'contracts', recordId: contract, action: 'update', ...by,
    before: { ...row, notes: 'Old private notes', billing_frequency: 'annual' },
    after: { ...row, name: 'Support Contract', notes: 'New private notes', billing_frequency: 'monthly', duration_months: 24 },
  });
  // The renewal service: a decision, a stop, a resume and the decision task, beside the saved row.
  await audit(runner, {
    table: 'contracts', recordId: contract, action: 'update', ...by,
    before: row,
    after: { ...row, renewal_decision: { decision: 'terminate', reason: 'Too expensive', task_id: null, term_end: '2026-12-31', deadline: '2026-11-30' } },
  });
  await audit(runner, {
    table: 'contracts', recordId: contract, action: 'update', ...by,
    before: row, after: { ...row, auto_renewal: false, renewal_stop: { end_date: '2026-12-31' } },
  });
  await audit(runner, {
    table: 'contracts', recordId: contract, action: 'update', ...by,
    before: { ...row, auto_renewal: false }, after: { ...row, auto_renewal: true, renewal_resume: { previous_end_date: '2026-12-31' } },
  });
  const [task] = await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id)
     VALUES ($1, 12, 'Decide the renewal', 'contract', $2) RETURNING id, to_jsonb(tasks) AS row`,
    [data.tenantId, contract],
  );
  await audit(runner, {
    table: 'contracts', recordId: contract, action: 'update', userId: null, source: 'system',
    before: { renewal_task: null },
    after: { renewal_task: { task_id: task.id, item_number: 12, term_end: '2026-12-31', deadline: '2026-11-30' } },
  });
  // The task itself, as the unified task writer audits it, and the legacy duplicate (excluded).
  await audit(runner, { table: 'tasks', recordId: task.id, action: 'create', after: task.row, ...by });
  const excludedRow = await audit(runner, { table: 'contract_tasks', recordId: task.id, action: 'create', after: task.row, ...by });

  const contactLink = { id: randomUUID(), tenant_id: data.tenantId, contract_id: contract, contact_id: data.contact, role: 'commercial', origin: 'manual' };
  await audit(runner, { table: 'contract_contacts', recordId: contactLink.id, action: 'create', after: contactLink, ...by });
  await audit(runner, { table: 'contract_contacts', recordId: contactLink.id, action: 'delete', before: contactLink, after: null, ...by });
  // The supplier sync: the contract in record_id, the `contact:role` states.
  await audit(runner, { table: 'contract_contacts', recordId: contract, action: 'update', before: [], after: [`${data.contact}:technical`], ...by });

  const link = { id: randomUUID(), tenant_id: data.tenantId, contract_id: contract, url: 'https://example.invalid/terms', description: 'Signed terms' };
  await audit(runner, { table: 'contract_links', recordId: link.id, action: 'create', before: null, after: link, ...by });
  await audit(runner, { table: 'contract_links', recordId: link.id, action: 'update', before: link, after: null, ...by });
  const attachment = {
    id: randomUUID(), tenant_id: data.tenantId, contract_id: contract, original_filename: 'contract.pdf',
    stored_filename: 'stored.pdf', mime_type: 'application/pdf', size: 1200, storage_path: 'files/contract.pdf', uploaded_at: '2026-01-01T00:00:00.000Z',
  };
  await audit(runner, { table: 'contract_attachments', recordId: attachment.id, action: 'create', before: null, after: attachment, ...by });
  await audit(runner, { table: 'contract_attachments', recordId: attachment.id, action: 'update', before: attachment, after: null, ...by });

  const item = { id: randomUUID(), contract_id: contract, requirement: 'exit_plan', state: 'present', reference: null };
  await audit(runner, { table: 'contract_compliance_items', recordId: item.id, action: 'create', before: null, after: item, ...by });
  await audit(runner, {
    table: 'contract_compliance_items', recordId: item.id, action: 'update', before: item,
    after: { ...item, state: 'not_applicable', reference: 'Clause 12' }, ...by,
  });
  await audit(runner, {
    table: 'contract_compliance_items', recordId: item.id, action: 'delete',
    before: { ...item, state: 'not_applicable', reference: 'Clause 12' }, after: null, ...by,
  });

  // The link sets written from the contract: record_id is the contract, `{ ids }` before and after.
  await audit(runner, {
    table: 'contract_spend_items', recordId: contract, action: 'update', ...by,
    before: { ids: [data.opexLine] }, after: { ids: [data.opexLine, data.capexLine, data.hiddenLine] },
  });
  await audit(runner, {
    table: 'contract_spend_items', recordId: contract, action: 'update', ...by,
    before: { ids: [data.opexLine, data.capexLine, data.hiddenLine] }, after: { ids: [data.capexLine] },
  });
  for (const [label, id] of [['application_contracts', data.application], ['asset_contracts', data.asset], ['technology_contracts', data.technology]] as const) {
    await audit(runner, { table: label, recordId: contract, action: 'update', before: { ids: [] }, after: { ids: [id] }, ...by });
    await audit(runner, { table: label, recordId: contract, action: 'update', before: { ids: [id] }, after: { ids: [] }, ...by });
  }
  // The assistant writes a link set as relation items (`{ key, label, payload }`) on contract B;
  // the stored label is the writer's and never comes out.
  const relation = (lineId: string) => ({ key: lineId, label: 'Writer label', payload: { spend_item_id: lineId } });
  await audit(runner, {
    table: 'contract_spend_items', recordId: data.contractB, action: 'update', ...by,
    before: [], after: [relation(data.opexLine), { key: 'not-an-id', label: 'Writer label', payload: { spend_item_id: data.hiddenLine } }],
  });
  await audit(runner, {
    table: 'contract_spend_items', recordId: data.contractB, action: 'update', ...by,
    before: [relation(data.opexLine)], after: [],
  });
  return { data, task: task.id, excludedRow, allReader, contractReader, noModules, limited, throughLine };
}

async function testAccess(seeded: Seeded, foreign: HistorySeed) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, data.contractA, ALL_MODULES);
  assert.ok(page.items.length > 0, 'a reader of the contracts reads the history');
  await assert.rejects(
    () => readPage(seeded.noModules, data.tenantId, data.contractA, { budget: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'no contracts module gets 403 MODULE_RIGHT_REQUIRED',
  );
  for (const [what, id] of [['an unknown id', randomUUID()], ['another tenant\'s contract', foreign.contractA]] as const) {
    await assert.rejects(
      () => readPage(seeded.allReader, data.tenantId, id, ALL_MODULES),
      (error: any) => error?.status === 404,
      `${what} gets 404`,
    );
  }
  await assert.rejects(
    () => readPage(seeded.limited, data.tenantId, data.contractB, LIMITED_MODULES, true),
    (error: any) => error?.status === 404,
    'a contract outside the person\'s data access gets 404',
  );
  console.log('  200 with contracts, 403 without, 404 unknown, foreign and out of scope: OK');
}

async function testRecordEntries(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, data.contractA, ALL_MODULES);

  const created = page.items.find((item) => item.subject.kind === 'record' && item.action === 'create');
  assert.ok(created, 'the creation is an entry');
  assert.equal((created!.changes.find((change) => change.field === 'supplier_id')?.after as any)?.label, 'Acme Supplies');
  assert.equal((created!.changes.find((change) => change.field === 'company_id')?.after as any)?.label, 'Alpha Co');
  assert.equal(created!.changes.some((change) => change.field === 'notes'), false, 'a creation never shows the notes');

  const updates = { ...page, items: page.items.filter((item) => item.subject.kind === 'record' && item.action === 'update') };
  const billing = one(updates, 'billing_frequency');
  assert.deepEqual([billing.change.before, billing.change.after], ['annual', 'monthly']);
  assert.deepEqual(one(updates, 'duration_months').change.after, 24);
  assert.deepEqual(one(page, 'notes').change, { field: 'notes', text: 'notesChanged' }, 'the notes say changed, never their text');

  assert.equal(one(page, 'renewal_decision').change.after, 'terminate');
  assert.equal(one(page, 'renewal_reason').change.after, 'Too expensive');
  assert.deepEqual(one(page, 'renewal_stop').change, { field: 'renewal_stop', text: 'renewalStopped' });
  assert.deepEqual(one(page, 'renewal_resume').change, { field: 'renewal_resume', text: 'renewalResumed' });
  const stop = one(page, 'renewal_stop').item;
  assert.deepEqual(stop.changes.find((change) => change.field === 'auto_renewal'), { field: 'auto_renewal', before: true, after: false });
  const renewalTask = one(page, 'renewal_task', 'added');
  assert.equal(renewalTask.item.actor.kind, 'system', 'the renewal task is the system\'s');
  assert.deepEqual(renewalTask.change.after, { kind: 'task', id: seeded.task, label: 'Decide the renewal', reference: 'T-12' });

  const serialized = JSON.stringify(page);
  for (const leak of ['Old private notes', 'New private notes', 'Old private', 'term_end', 'storage_path', 'files/contract.pdf']) {
    assert.ok(!serialized.includes(leak), `never in the answer: ${leak}`);
  }
  console.log('  contract creation, modification, hidden notes and renewal markers in words: OK');
}

async function testChildEntries(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, data.contractA, ALL_MODULES);
  assert.equal(page.items.some((item) => item.id === seeded.excludedRow), false, 'the legacy contract task row is excluded');
  const task = one(page, 'task', 'added');
  assert.equal(task.item.subject.kind, 'task');
  assert.equal(labelOf(task.change.after), 'Decide the renewal', 'the contract task is named');

  const contacts = changes(page, 'contact', 'added');
  assert.equal(contacts.length, 2, 'the manual link and the supplier sync add the contact');
  assert.ok(contacts.every(({ change }) => labelOf(change.after) === 'Cora Contact'), 'the contact is named');
  assert.equal(labelOf(one(page, 'contact', 'removed').change.before), 'Cora Contact');
  assert.equal(changes(page, 'role').some(({ change }) => change.after === 'commercial'), true, 'the role of the link');

  assert.equal(one(page, 'link', 'added').change.after && (one(page, 'link', 'added').change.after as any).label, 'Signed terms');
  assert.ok(one(page, 'link', 'removed'), 'the web link is removed');
  assert.equal((one(page, 'attachment', 'added').change.after as any).label, 'contract.pdf');
  assert.ok(one(page, 'attachment', 'removed'), 'the attachment is removed');

  const compliance = page.items.filter((item) => item.subject.kind === 'compliance_item');
  assert.equal(compliance.length, 3, 'the compliance item creation, update and deletion');
  assert.ok(compliance.every((item) => item.subject.label === 'exit_plan'), 'named by its requirement');
  const states = compliance.map((item) => item.changes.find((change) => change.field === 'compliance_state'));
  assert.deepEqual(states.map((change) => [change?.before, change?.after]), [
    ['not_applicable', null],
    ['present', 'not_applicable'],
    [null, 'present'],
  ]);
  assert.deepEqual(
    compliance[1].changes.find((change) => change.field === 'compliance_reference'),
    { field: 'compliance_reference', before: null, after: 'Clause 12' },
  );

  const lines = changes(page, 'budget_line', 'added').map(({ change }) => (change.after as any).reference).sort();
  assert.deepEqual(lines, ['BL-2', 'BL-3'], 'the lines added are named for a budget reader');
  assert.deepEqual(changes(page, 'budget_line', 'removed').map(({ change }) => (change.before as any).reference).sort(), ['BL-1', 'BL-3']);
  assert.equal(changes(page, 'budget_lines_outside').length, 0, 'nothing is counted out of sight for this reader');

  for (const [field, label] of [['application', 'Ledger App'], ['asset', 'Server One'], ['technology', 'Postgres']] as const) {
    assert.equal(labelOf(one(page, field, 'added').change.after), label, `${field} added and named`);
    assert.equal(labelOf(one(page, field, 'removed').change.before), label, `${field} removed and named`);
  }
  console.log('  task, contacts, link, attachment, compliance item, lines, applications, assets, technologies: OK');
}

async function testReferencesWithoutModules(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.contractReader, data.tenantId, data.contractA, CONTRACT_ONLY);
  assert.deepEqual(one(page, 'application', 'added').change.after, { hidden: true, kind: 'application' });
  assert.deepEqual(one(page, 'asset', 'added').change.after, { hidden: true, kind: 'asset' });
  assert.deepEqual(one(page, 'technology', 'added').change.after, { hidden: true, kind: 'technology' });
  assert.ok(changes(page, 'contact', 'added').every(({ change }) => (change.after as any)?.hidden === true), 'a contact is hidden');
  assert.deepEqual(one(page, 'renewal_task', 'added').change.after, { hidden: true, kind: 'task' }, 'the task is hidden without tasks');
  assert.equal(changes(page, 'budget_line').length, 0, 'no line is named without the budget');
  assert.equal(one(page, 'budget_lines_outside', 'added').change.after, 2);
  assert.equal(one(page, 'budget_lines_outside', 'removed').change.before, 2);
  const serialized = JSON.stringify(page);
  for (const name of ['Ledger App', 'Server One', 'Postgres', 'Cora', 'Main line', 'BL-1', 'T-12', 'Decide the renewal']) {
    assert.ok(!serialized.includes(name), `not named without its module: ${name}`);
  }
  console.log('  a contracts-only reader sees the other modules unnamed and the lines counted: OK');
}

async function testLimited(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.limited, data.tenantId, data.contractA, LIMITED_MODULES, true);
  assert.deepEqual(changes(page, 'budget_line', 'added').map(({ change }) => (change.after as any).reference), ['BL-2']);
  assert.deepEqual(changes(page, 'budget_line', 'removed').map(({ change }) => (change.before as any).reference), ['BL-1']);
  assert.equal(one(page, 'budget_lines_outside', 'added').change.after, 1, 'the out-of-scope line added is counted');
  assert.equal(one(page, 'budget_lines_outside', 'removed').change.before, 1, 'the out-of-scope line removed is counted');
  const serialized = JSON.stringify(page);
  assert.ok(!serialized.includes('Beta line') && !serialized.includes('BL-3'), 'the out-of-scope line is never named');
  console.log('  a limited person reads the contract of their scope, the other lines counted: OK');
}

/**
 * The page closes the documents of a contract read through one of its lines (policies
 * `CONTRACT_DOCUMENTS`, only `closed_documents_count` on the page): the history leaves out their
 * entries, so no file name, link label or URL comes out. A direct reader keeps them.
 */
async function testDocumentsThroughLine(seeded: Seeded) {
  const { data } = seeded;
  const direct = await readPage(seeded.limited, data.tenantId, data.contractA, LIMITED_MODULES, true);
  assert.equal(labelOf(one(direct, 'link', 'added').change.after), 'Signed terms', 'a direct reader reads the link');
  assert.equal(labelOf(one(direct, 'attachment', 'added').change.after), 'contract.pdf', 'a direct reader reads the attachment');

  const page = await readPage(seeded.throughLine, data.tenantId, data.contractA, LIMITED_MODULES, true);
  assert.ok(page.items.length > 0, 'the contract opens through its line, with its history');
  assert.ok(page.items.some((item) => item.subject.kind === 'record'), 'the contract\'s own entries stay');
  assert.equal(page.items.some((item) => item.subject.kind === 'link' || item.subject.kind === 'attachment'), false, 'no document entry');
  assert.equal(changes(page, 'link').length + changes(page, 'attachment').length, 0, 'no document change');
  const serialized = JSON.stringify(page);
  for (const leak of ['Signed terms', 'example.invalid/terms', 'contract.pdf']) {
    assert.ok(!serialized.includes(leak), `never through a line: ${leak}`);
  }
  console.log('  a contract read through a line keeps its documents closed, a direct reader reads them: OK');
}

async function testAssistantLinkSet(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, data.contractB, ALL_MODULES);
  const added = changes(page, 'budget_line', 'added').map(({ change }) => (change.after as any).reference).sort();
  assert.deepEqual(added, ['BL-1', 'BL-3'], 'the lines the assistant added, read by key or payload id');
  assert.deepEqual(changes(page, 'budget_line', 'removed').map(({ change }) => (change.before as any).reference), ['BL-1']);
  assert.ok(!JSON.stringify(page).includes('Writer label'), 'the stored label never comes out');
  console.log('  a link set written by the assistant reads as its lines: OK');
}

async function testParentRows(seeded: Seeded) {
  const { data } = seeded;
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [data.tenantId]);
    const rows: Array<{ table_name: string; parent_table: string | null; parent_id: string | null }> = await runner.query(
      `SELECT DISTINCT table_name, parent_table, parent_id::text AS parent_id
         FROM audit_log
        WHERE tenant_id = $1
          AND table_name IN ('contract_contacts', 'contract_links', 'contract_attachments', 'contract_compliance_items', 'tasks', 'contract_tasks')`,
      [data.tenantId],
    );
    for (const label of ['contract_contacts', 'contract_links', 'contract_attachments', 'contract_compliance_items', 'tasks']) {
      const parents = rows.filter((row) => row.table_name === label);
      assert.ok(parents.length > 0, `${label}: rows`);
      assert.ok(parents.every((row) => row.parent_table === 'contracts' && row.parent_id === data.contractA), `${label}: the contract is the parent`);
    }
    assert.ok(rows.filter((row) => row.table_name === 'contract_tasks').every((row) => row.parent_id === null), 'contract_tasks has no parent');
  } finally {
    await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
  console.log('  the writer fills the contract parent of the children and the task: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-contracts');
  const foreignTenantId = await createRaceTenant('record-history-contracts-foreign');
  try {
    const seeded = await seed(tenantId, async (runner) => seedAudits(runner, await seedHistoryData(runner, tenantId)));
    const foreign = await seed(foreignTenantId, (runner) => seedHistoryData(runner, foreignTenantId));
    console.log('record history contracts');
    await testAccess(seeded, foreign);
    await testRecordEntries(seeded);
    await testChildEntries(seeded);
    await testReferencesWithoutModules(seeded);
    await testLimited(seeded);
    await testDocumentsThroughLine(seeded);
    await testAssistantLinkSet(seeded);
    await testParentRows(seeded);
    console.log('record-history-contracts.integration.spec: ok');
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
