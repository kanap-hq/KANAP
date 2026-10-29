// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { RecordHistoryService, type RecordHistoryContext, type RecordHistoryItem } from '../record-history.service';
import {
  audit,
  linePayload,
  seedHistoryData,
  seedPerson,
  type HistorySeed,
  type Person,
} from './record-history.fixtures';

// The history of a budget line (lot 1B) on the migrated database: one entry per audit row, the
// children attached by the parent columns, the two natures, the cursor over more than a page, the
// permissions and data access of the record's page, the reference resolution with no neighbouring
// label leak, and the four authors. The audit rows go through the real writer, so the parent rules
// of lot 1A fill `parent_table` / `parent_id` as the history reads them.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const YEAR = 2026;

const ALL_MODULES = {
  budget: 'reader', contracts: 'reader', suppliers: 'reader', companies: 'reader', accounts: 'reader',
  portfolio_projects: 'reader', portfolio_requests: 'reader', contacts: 'reader', applications: 'reader', infrastructure: 'reader', tasks: 'reader',
};

type Seeded = {
  seed: HistorySeed;
  reader: Person;
  noModules: Person;
  limited: Person;
  audits: { taskUpdate: string; aiLink: string; aiContact: string; importRow: string; copyRow: string };
};

function context(person: Person, permissions: Record<string, string>, isAdmin = false): RecordHistoryContext {
  return {
    tenantId: person.tenant_id,
    userId: person.id,
    isAdmin,
    permissions,
    // Filled by the read helper with the request transaction's manager.
    manager: undefined,
  };
}

function withManager(ctx: RecordHistoryContext, runner: QueryRunner): RecordHistoryContext {
  return { ...ctx, manager: runner.manager };
}

async function readWith<T>(person: Person, seed: HistorySeed, fn: (service: RecordHistoryService, ctx: RecordHistoryContext, runner: QueryRunner) => Promise<T>, options: { limited?: boolean; permissions?: Record<string, string> } = {}): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [seed.tenantId]);
    if (options.limited) {
      const rows: Array<{ mode: string }> = await runner.query(`SELECT data_access_apply($1) AS mode`, [person.id]);
      assert.equal(rows[0]?.mode, 'limited', 'the limited role is applied to the transaction');
    }
    const ctx = withManager(context(person, options.permissions ?? {}), runner);
    return await fn(new RecordHistoryService(), ctx, runner);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

async function readPage(person: Person, seed: HistorySeed, table: string, id: string, query: Record<string, unknown>, permissions: Record<string, string>, limited = false) {
  return readWith(person, seed, (service, ctx) => service.list(ctx, table, id, query), { permissions, limited });
}

/** A read under the tenant, for the assertions that compare the service with the stored rows. */
async function tenantQuery<T>(tenantId: string, sql: string, params: unknown[]): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return await runner.query(sql, params);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

function itemKinds(page: { items: RecordHistoryItem[] }): string[] {
  return page.items.map((item) => item.subject.kind);
}

function findChange(page: { items: RecordHistoryItem[] }, field: string) {
  for (const item of page.items) {
    const change = item.changes.find((candidate) => candidate.field === field);
    if (change) return { item, change };
  }
  return null;
}

async function testEntriesAndChildren(seedRow: Seeded) {
  const page = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.opexLine, { limit: '100' }, ALL_MODULES);
  const rows = await tenantQuery<Array<{ n: number }>>(
    seedRow.seed.tenantId,
    `SELECT count(*)::int AS n FROM audit_log
      WHERE tenant_id = $1 AND (record_id = $2 OR parent_id = $2)`,
    [seedRow.seed.tenantId, seedRow.seed.opexLine],
  );
  assert.ok(page.items.length <= rows[0].n, 'no more entries than audit rows');
  assert.ok(page.items.length < rows[0].n, 'an update without a presentable change is not an entry');
  assert.equal(new Set(page.items.map((item) => item.id)).size, page.items.length, 'no duplicated entry');

  for (const kind of ['record', 'version', 'amounts', 'allocations', 'round_input', 'link', 'attachment', 'contact', 'application', 'technology', 'asset', 'contract', 'project', 'request', 'task']) {
    assert.ok(itemKinds(page).includes(kind), `${kind}: an entry of that subject kind`);
  }

  const amount = page.items
    .flatMap((item) => item.changes)
    .find((change) => change.field === 'planned' && change.months?.length === 2 && change.before === '100.00');
  assert.ok(amount, 'the amount change is present');
  assert.equal(amount.year, YEAR);
  assert.equal(amount.column, 'planned');
  assert.equal(amount.before, '100.00');
  assert.equal(amount.after, '150.00');
  assert.deepEqual(amount.months, ['2026-01', '2026-02'], 'the months the write touched');
  assert.equal(amount.wholeYear, undefined, 'a two-month write is not a whole year');

  const allocations = findChange(page, 'allocations');
  assert.ok(allocations, 'the allocation change is present');
  assert.equal(allocations.change.before, 1);
  assert.equal(allocations.change.after, 2);

  const links = page.items.filter((item) => item.subject.kind === 'link' && item.subject.label === 'Spec link');
  assert.ok(links.some((item) => item.changes[0]?.event === 'added'), 'the link is added with its description');
  assert.ok(links.some((item) => item.changes[0]?.event === 'removed'), 'the link is removed');

  const attachments = page.items.filter((item) => item.subject.kind === 'attachment');
  assert.ok(attachments.some((item) => item.subject.label === 'note.txt' && item.changes[0]?.event === 'added'), 'the attachment is added');
  assert.ok(attachments.some((item) => item.subject.label === 'note.txt' && item.changes[0]?.event === 'removed'), 'the attachment is removed');

  const contacts = page.items.filter((item) => item.subject.kind === 'contact');
  assert.ok(contacts.length >= 2, 'the contact link creation and removal');
  assert.ok(contacts.every((item) => item.subject.label === 'Cora Contact'));
  assert.ok(contacts.some((item) => item.changes[0]?.event === 'added'), 'the contact is added');
  assert.ok(contacts.some((item) => item.changes[0]?.event === 'removed'), 'the contact is removed');

  assert.equal(page.items.some((item) => item.id === seedRow.audits.taskUpdate), false,
    'the legacy line task label, a duplicate of the `tasks` row, is not an entry');

  const aiLink = page.items.find((item) => item.id === seedRow.audits.aiLink);
  assert.ok(aiLink, 'the assistant link replacement is in the history');
  assert.ok(aiLink.changes.some((change) => change.event === 'removed' && change.before === 'Old docs'), 'the removed link is named');
  assert.ok(aiLink.changes.some((change) => change.event === 'added' && change.after === 'New docs'), 'the added link is named');
  assert.equal(aiLink.changes.length, 2, 'no empty change beside the two links');

  const aiContact = page.items.find((item) => item.id === seedRow.audits.aiContact);
  assert.ok(aiContact, 'the assistant contact change is in the history');
  assert.ok(aiContact.changes.some((change) => change.event === 'added' && (change.after as any)?.label === 'Cora Contact'), 'the added contact is named');
  assert.ok(aiContact.changes.some((change) => change.event === 'removed' && (change.before as any)?.label === 'Cora Contact'), 'the removed role is named');

  assert.equal(page.items.some((item) => item.id === seedRow.audits.importRow), false,
    'a budget-file update with no presentable field is not an entry');
  assert.equal(page.items.some((item) => item.id === seedRow.audits.copyRow), false,
    'an allocation-copy update with no presentable field is not an entry');

  const dimension = findChange(page, 'dimension');
  assert.ok(dimension, 'the dimension change is present');
  assert.equal(dimension.change.dimension, 'Cost pool');
  assert.equal(dimension.change.before, 'Cloud');
  assert.equal(dimension.change.after, 'On premise');

  console.log('  one entry per write, children attached, structured changes: OK');
}

async function testNaturesAndTypeChange(seedRow: Seeded) {
  const page = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.capexLine, { limit: '100' }, { budget: 'reader' });
  assert.ok(page.items.length >= 4, `the CAPEX line has a history (${page.items.length})`);
  assert.ok(itemKinds(page).includes('record'), 'the CAPEX line own row');
  assert.ok(itemKinds(page).includes('version'), 'the CAPEX version row');
  assert.ok(itemKinds(page).includes('amounts'), 'the CAPEX amount row');
  assert.ok(itemKinds(page).includes('link'), 'the CAPEX link row');
  assert.ok(itemKinds(page).includes('attachment'), 'the CAPEX attachment row');
  assert.ok(itemKinds(page).includes('contact'), 'the CAPEX contact sync row');
  const monthly = page.items
    .flatMap((item) => item.changes)
    .find((change) => change.field === 'planned' && change.monthlyOnly === true);
  assert.ok(monthly, 'a change of the monthly distribution alone is flagged');
  assert.equal(monthly.before, '200.00');
  assert.equal(monthly.after, '200.00');
  assert.deepEqual(monthly.months, ['2026-01', '2026-02'], 'the redistributed months');
  const allocationCopy = page.items
    .flatMap((item) => item.changes)
    .find((change) => change.field === 'allocations' && change.sourceYear === 2025);
  assert.ok(allocationCopy, 'the allocation copy names its source year');
  assert.equal(allocationCopy.year, 2026);

  // A line that changed nature keeps its rows under the old and the new label; both are read.
  const labels = await tenantQuery<Array<{ table_name: string }>>(
    seedRow.seed.tenantId,
    `SELECT table_name FROM audit_log WHERE tenant_id = $1 AND record_id = $2 ORDER BY table_name`,
    [seedRow.seed.tenantId, seedRow.seed.typeLine],
  );
  assert.deepEqual(labels.map((row) => row.table_name).sort(), ['capex_items', 'spend_items'], 'both audit labels are stored');
  const typePage = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.typeLine, { limit: '100' }, { budget: 'reader' });
  const recordChanges = typePage.items.filter((item) => item.subject.kind === 'record');
  assert.equal(recordChanges.length, 2, 'both rows are in the history');
  assert.ok(
    recordChanges.every((item) => item.changes.some((change) => change.field === 'nature' && change.after === 'capex')),
    'the type change reads under both labels',
  );
  console.log('  CAPEX labels and a line changed from OPEX to CAPEX: OK');
}

async function testFlatAmounts(seedRow: Seeded) {
  const page = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.opexLine, { limit: '100' }, { budget: 'reader' });
  const amounts = page.items.filter((item) => item.subject.kind === 'amounts');
  const created = amounts
    .flatMap((item) => item.changes)
    .find((change) => change.field === 'planned' && change.wholeYear === true && change.after === '12000.00' && change.before === undefined);
  assert.ok(created, 'the budget file yearly total is presented');
  assert.equal(created.year, YEAR, 'the flat spread names its year');
  assert.equal(created.column, 'planned');
  assert.equal(created.before, undefined, 'a flat spread with no before names only the total it set');
  const forecast = amounts
    .flatMap((item) => item.changes)
    .find((change) => change.field === 'forecast' && change.wholeYear === true);
  assert.ok(forecast, 'every column of the yearly totals is presented');
  assert.equal(forecast.after, '3000.00');
  const hadBefore = amounts
    .flatMap((item) => item.changes)
    .find((change) => change.field === 'planned' && change.before === '10000.00' && change.after === '12000.00');
  assert.ok(hadBefore, 'before.totals is read when the payload carries it');
  assert.equal(hadBefore.wholeYear, true);
  console.log('  budget-file yearly totals per column, before.totals when present: OK');
}

async function testTechnicalChildren(seedRow: Seeded) {
  const page = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.opexLine, { limit: '100' }, ALL_MODULES);

  const versionCreate = page.items.find((item) => item.subject.kind === 'version' && item.action === 'create');
  assert.ok(versionCreate, 'the version creation is an entry');
  assert.deepEqual(versionCreate.changes, [], 'a version creation shows its title only');
  const versionUpdate = page.items.find((item) => item.subject.kind === 'version' && item.changes.some((change) => change.field === 'input_grain'));
  assert.ok(versionUpdate, 'the version update is an entry');
  assert.deepEqual(versionUpdate.changes.map((change) => change.field), ['input_grain'], 'a version update keeps its changed fields');
  assert.equal(versionUpdate.changes[0]?.after, 'annual');

  const inputCreate = page.items.find((item) => item.subject.kind === 'round_input' && item.action === 'create');
  assert.ok(inputCreate, 'the budget input creation is an entry');
  assert.deepEqual(inputCreate.changes, [], 'a budget input creation shows its title only');
  const inputUpdate = page.items.find((item) => item.subject.kind === 'round_input' && item.changes.some((change) => change.field === 'fte'));
  assert.ok(inputUpdate, 'the budget input update is an entry');
  assert.deepEqual(inputUpdate.changes.map((change) => change.field), ['fte'], 'updated_by is not a field of the history');
  assert.equal(inputUpdate.changes[0]?.after, '2.00');

  const allocationCreate = page.items.find((item) => item.subject.kind === 'allocations' && item.action === 'create');
  assert.ok(allocationCreate, 'the first allocation rows are a creation');
  assert.deepEqual(allocationCreate.changes, [], 'an allocation creation shows its title only');
  console.log('  technical child creations show their title only, updates keep their fields: OK');
}

async function testPagination(seedRow: Seeded) {
  const expected = await tenantQuery<Array<{ id: string }>>(
    seedRow.seed.tenantId,
    `SELECT id FROM audit_log
      WHERE tenant_id = $1 AND table_name = 'spend_items' AND record_id = $2
      ORDER BY created_at DESC, id DESC`,
    [seedRow.seed.tenantId, seedRow.seed.pageLine],
  );
  assert.equal(expected.length, 120, '120 audit rows seeded');

  const first = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.pageLine, { limit: '50' }, { budget: 'reader' });
  assert.equal(first.items.length, 50);
  assert.ok(first.nextCursor, 'a next cursor');
  const second = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.pageLine, { limit: '50', cursor: first.nextCursor }, { budget: 'reader' });
  assert.equal(second.items.length, 50);
  assert.ok(second.nextCursor, 'a next cursor');
  const third = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.pageLine, { limit: '50', cursor: second.nextCursor }, { budget: 'reader' });
  assert.equal(third.items.length, 20);
  assert.equal(third.nextCursor, null, 'the last page');

  const got = [...first.items, ...second.items, ...third.items].map((item) => item.id);
  assert.deepEqual(got, expected.map((row) => row.id), 'no duplicate and no gap across the three pages');
  assert.equal(new Set(got).size, 120);

  const capped = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.pageLine, { limit: '500' }, { budget: 'reader' });
  assert.equal(capped.items.length, 100, 'the limit is capped at 100');
  assert.ok(capped.nextCursor, 'a next page follows the cap');

  await assert.rejects(
    () => readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.pageLine, { limit: '50', cursor: 'not-a-cursor' }, { budget: 'reader' }),
    /Invalid cursor/,
  );
  for (const at of ['not-a-date', '1', 'x 1', '2026-01-01', '2026-02-30T00:00:00Z', '2026-01-01T00:00:00']) {
    const badDate = Buffer.from(JSON.stringify({ at, id: randomUUID() })).toString('base64url');
    await assert.rejects(
      () => readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.pageLine, { limit: '50', cursor: badDate }, { budget: 'reader' }),
      /Invalid cursor/,
      `the cursor timestamp ${at} is refused`,
    );
  }
  const complete = Buffer.from(JSON.stringify({ at: '2026-01-01T00:00:00.000Z', id: randomUUID() })).toString('base64url');
  const beforeAnyRow = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.pageLine, { limit: '50', cursor: complete }, { budget: 'reader' });
  assert.equal(beforeAnyRow.items.length, 0, 'a complete ISO timestamp is accepted');
  console.log('  120 writes, stable cursor, no duplicate and no gap: OK');
}

async function testEmptyPages(seedRow: Seeded) {
  // The newest two rows present no change, the oldest one does: the pages follow audit rows, so a
  // page can hold no entry and still have a next cursor.
  const first = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.emptyPageLine, { limit: '1' }, { budget: 'reader' });
  assert.equal(first.items.length, 0, 'the first row is an empty update');
  assert.ok(first.nextCursor, 'the empty page still has a next page');
  const second = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.emptyPageLine, { limit: '1', cursor: first.nextCursor }, { budget: 'reader' });
  assert.equal(second.items.length, 0, 'the second row is an empty update too');
  assert.ok(second.nextCursor, 'the second empty page still has a next page');
  const third = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.emptyPageLine, { limit: '1', cursor: second.nextCursor }, { budget: 'reader' });
  assert.equal(third.items.length, 1, 'the third row presents a change');
  assert.equal(third.items[0].changes[0]?.field, 'notes');
  assert.equal(third.nextCursor, null, 'the last page');
  console.log('  empty update pages keep the cursor and the next page: OK');
}

async function testPermissionsAndAccess(seedRow: Seeded) {
  const reader = seedRow.reader;
  const seeded = seedRow.seed;
  await assert.rejects(
    () => readPage(seedRow.noModules, seeded, 'spend_items', seeded.opexLine, {}, { tasks: 'reader' }),
    (error: any) => error?.status === 403,
    'a reader without budget:reader gets 403',
  );
  await assert.rejects(
    () => readPage(reader, seeded, 'unknown_table', seeded.opexLine, {}, { budget: 'reader' }),
    (error: any) => error?.status === 404,
    'an unknown table gets 404',
  );
  await assert.rejects(
    () => readPage(reader, seeded, 'spend_items', 'not-a-uuid', {}, { budget: 'reader' }),
    (error: any) => error?.status === 404,
    'a malformed id gets 404',
  );
  await assert.rejects(
    () => readPage(reader, seeded, 'spend_items', randomUUID(), {}, { budget: 'reader' }),
    (error: any) => error?.status === 404,
    'a missing line gets 404',
  );

  const permissions = { budget: 'reader', contracts: 'reader', suppliers: 'reader' };
  await assert.rejects(
    () => readPage(seedRow.limited, seeded, 'spend_items', seeded.hiddenLine, {}, permissions, true),
    (error: any) => error?.status === 404,
    'a line outside the limited person access gets 404',
  );
  const visible = await readPage(seedRow.limited, seeded, 'spend_items', seeded.opexLine, {}, permissions, true);
  assert.ok(visible.items.length > 0, 'a line inside the limited person access is served');
  console.log('  403 without budget:reader, 404 for unknown, missing and out-of-access lines, 200 in access: OK');
}

async function testReferences(seedRow: Seeded) {
  const seeded = seedRow.seed;
  const visible = await readPage(seedRow.reader, seeded, 'spend_items', seeded.opexLine, { limit: '100' }, ALL_MODULES);
  const supplier = findChange(visible, 'supplier_id');
  assert.ok(supplier, 'the supplier field changed');
  assert.equal((supplier.change.after as any)?.label, 'Acme Supplies');
  const contract = findChange(visible, 'contract_id');
  assert.ok(contract, 'the contract field changed');
  assert.equal((contract.change.after as any)?.label, 'Beta Contract');
  const project = findChange(visible, 'project_id');
  assert.ok(project, 'the project field changed');
  assert.equal((project.change.after as any)?.reference, 'PRJ-7');
  const application = visible.items.find((item) => item.subject.kind === 'application' && item.changes.some((change) => change.event === 'added'));
  assert.ok(application, 'the application link is present');
  assert.equal((application.changes[0]?.after as any)?.label, 'Ledger App');
  assert.equal((application.changes[0]?.after as any)?.reference, 'APP-42');
  const technology = visible.items.find((item) => item.subject.kind === 'technology' && item.changes.some((change) => change.event === 'added'));
  assert.ok(technology, 'the technology link is present');
  assert.equal((technology.changes[0]?.after as any)?.reference, 'TEC-9');
  const asset = visible.items.find((item) => item.subject.kind === 'asset' && item.changes.some((change) => change.event === 'added'));
  assert.ok(asset, 'the asset link is present');
  assert.equal((asset.changes[0]?.after as any)?.reference, 'AST-1');
  const tasksAdded = visible.items.filter((item) => item.subject.kind === 'task' && item.changes.some((change) => change.event === 'added'));
  assert.equal(tasksAdded.length, 1, 'a task created on the line shows once, the legacy duplicate excluded');
  const task = tasksAdded[0];
  assert.ok(task, 'the task is present');
  assert.equal((task.changes[0]?.after as any)?.reference, 'T-5');

  const contractAdded = visible.items.find((item) => item.subject.kind === 'contract' && item.changes.some((change) => change.event === 'added'));
  assert.ok(contractAdded, 'the contract link added from the contract side is present');
  assert.equal((contractAdded.changes[0]?.after as any)?.label, 'Beta Contract');
  const contractRemoved = visible.items.find((item) => item.subject.kind === 'contract' && item.changes.some((change) => change.event === 'removed'));
  assert.ok(contractRemoved, 'the contract link removed from the contract side is present');
  assert.equal((contractRemoved.changes[0]?.before as any)?.label, 'Support Contract');
  const projectLink = visible.items.find((item) => item.subject.kind === 'project' && item.changes.some((change) => change.event === 'added'));
  assert.ok(projectLink, 'the project link added from the line is present');
  assert.equal((projectLink.changes[0]?.after as any)?.label, 'Project Alpha');
  assert.equal((projectLink.changes[0]?.after as any)?.reference, 'PRJ-7');
  const requestLink = visible.items.find((item) => item.subject.kind === 'request' && item.changes.some((change) => change.event === 'added'));
  assert.ok(requestLink, 'the request link added from the line is present');
  assert.equal((requestLink.changes[0]?.after as any)?.label, 'Request Alpha');
  assert.equal((requestLink.changes[0]?.after as any)?.reference, 'REQ-11');

  // A person without suppliers, contracts or the other modules sees the references hidden, and the
  // neighbouring names the payload carries are never copied.
  const hidden = await readPage(seedRow.noModules, seeded, 'spend_items', seeded.opexLine, { limit: '100' }, { budget: 'reader' });
  const hiddenSupplier = findChange(hidden, 'supplier_id');
  assert.deepEqual(hiddenSupplier?.change.after, { hidden: true, kind: 'supplier' });
  const hiddenContract = findChange(hidden, 'contract_id');
  assert.deepEqual(hiddenContract?.change.after, { hidden: true, kind: 'contract' });
  for (const kind of ['contract', 'project', 'request']) {
    const link = hidden.items.find((item) => item.subject.kind === kind && item.changes.some((change) => change.event === 'added'));
    assert.ok(link, `${kind}: the added link row is read`);
    assert.deepEqual(link.changes[0]?.after, { hidden: true, kind }, `${kind}: a link of a module the reader cannot read is hidden`);
  }
  const serialized = JSON.stringify(hidden);
  assert.ok(!serialized.includes('Leaked Supplier Name'), 'no neighbouring supplier name leaks');
  assert.ok(!serialized.includes('Leaked Contract Name'), 'no neighbouring contract name leaks');
  assert.ok(!serialized.includes('Project Alpha'), 'the hidden project name is not copied');
  assert.ok(!serialized.includes('Request Alpha'), 'the hidden request name is not copied');

  // A limited person reads `contracts`, but the contract outside their access is hidden.
  const limitedPermissions = { budget: 'reader', contracts: 'reader', suppliers: 'reader' };
  const limited = await readPage(seedRow.limited, seeded, 'spend_items', seeded.opexLine, { limit: '100' }, limitedPermissions, true);
  const limitedContract = findChange(limited, 'contract_id');
  assert.ok(limitedContract, 'the limited person sees the contract field change');
  assert.deepEqual(limitedContract.change.after, { hidden: true, kind: 'contract' }, 'the contract outside their access is hidden');
  assert.ok(!JSON.stringify(limited).includes('Beta Contract'), 'the hidden contract name is not copied');
  console.log('  references named for readers, hidden for modules and out-of-access contracts, no neighbour leak: OK');
}

async function testUnknownChildLabel(seedRow: Seeded) {
  const unknown = await seed(seedRow.seed.tenantId, (runner) => audit(runner, {
    table: 'spend_links_archive',
    recordId: randomUUID(),
    action: 'update',
    userId: seedRow.reader.id,
    parent: { table: 'spend_items', id: seedRow.seed.opexLine },
    before: { url: 'https://example.invalid/archived' },
    after: { url: 'https://example.invalid/archived-2' },
  }));
  const page = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.opexLine, { limit: '100' }, { budget: 'reader' });
  assert.ok(!page.items.some((item) => item.id === unknown), 'a parent row of a label that is not a declared child stays out');
  console.log('  a parent row of an undeclared label is not the record\'s own history: OK');
}

async function testAuthors(seedRow: Seeded) {
  const page = await readPage(seedRow.reader, seedRow.seed, 'spend_items', seedRow.seed.opexLine, { limit: '100' }, { budget: 'reader' });
  const actors = page.items.map((item) => item.actor);
  const user = actors.find((actor) => actor.kind === 'user');
  assert.ok(user && user.name === 'Ava Reader', 'the person is named');
  const system = actors.find((actor) => actor.kind === 'system');
  assert.ok(system && system.name === null, 'the system has no name');
  const imported = actors.find((actor) => actor.kind === 'import');
  assert.ok(imported && imported.name === 'Ava Reader', 'the import names the person who imported');
  const assistant = actors.find((actor) => actor.kind === 'assistant');
  assert.ok(assistant && assistant.name === 'Ava Reader', 'the assistant names the person it acted for');
  console.log('  authors: person, system, budget file import, assistant: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history');
  try {
    const seeded = await seed(tenantId, async (runner) => {
      const seedData = await seedHistoryData(runner, tenantId);
      const reader = await seedPerson(runner, tenantId, { first: 'Ava', last: 'Reader' }, { budget: 'reader' });
      const noModules = await seedPerson(runner, tenantId, { first: 'Noa', last: 'Reader' }, { budget: 'reader' });
      const limited = await seedPerson(runner, tenantId, { first: 'Lila', last: 'Limited' }, { budget: 'reader', contracts: 'reader', suppliers: 'reader' }, { mode: 'limited', nodeCompanyId: seedData.companyA });

      const line = seedData.opexLine;
      const version = seedData.opexVersion;
      await audit(runner, {
        table: 'spend_items', recordId: line, action: 'create', userId: reader.id,
        after: {
          ...linePayload(seedData, line),
          supplier_name: 'Leaked Supplier Name',
          contract_name: 'Leaked Contract Name',
        },
      });
      await audit(runner, {
        table: 'spend_versions', recordId: version, action: 'create', userId: reader.id,
        after: { id: version, tenant_id: seedData.tenantId, spend_item_id: line, version_name: 'Y2026', budget_year: YEAR, allocation_method: 'manual_pct' },
      });
      await audit(runner, {
        table: 'spend_versions', recordId: version, action: 'update', userId: reader.id,
        before: { id: version, tenant_id: seedData.tenantId, version_name: 'Y2026', input_grain: 'monthly' },
        after: { id: version, tenant_id: seedData.tenantId, version_name: 'Y2026', input_grain: 'annual' },
      });
      await audit(runner, {
        table: 'spend_round_inputs', recordId: randomUUID(), action: 'update', userId: reader.id,
        before: { tenant_id: seedData.tenantId, version_id: version, measure: 'planned', fte: '1.00', updated_by: reader.id },
        after: { tenant_id: seedData.tenantId, version_id: version, measure: 'planned', fte: '2.00', updated_by: reader.id },
      });
      await audit(runner, {
        table: 'spend_allocations', recordId: version, action: 'update', userId: reader.id,
        before: [],
        after: [{ id: randomUUID(), tenant_id: seedData.tenantId, version_id: version, company_id: seedData.companyA, allocation_pct: '100.00' }],
      });
      await audit(runner, {
        table: 'spend_amounts', recordId: version, action: 'update', userId: reader.id,
        before: [{ id: randomUUID(), tenant_id: seedData.tenantId, version_id: version, period: '2026-01-01', planned: '100.00' }],
        after: [
          { id: randomUUID(), tenant_id: seedData.tenantId, version_id: version, period: '2026-01-01', planned: '100.00' },
          { id: randomUUID(), tenant_id: seedData.tenantId, version_id: version, period: '2026-02-01', planned: '50.00' },
        ],
      });
      // The budget file's flat spread writes yearly totals, without month rows.
      await audit(runner, {
        table: 'spend_amounts', recordId: version, action: 'update', userId: reader.id,
        before: null,
        after: { source: 'budget_file', year: YEAR, totals: { planned: '12000.00', forecast: '3000.00' } },
      });
      await audit(runner, {
        table: 'spend_amounts', recordId: version, action: 'update', userId: reader.id,
        before: { totals: { planned: '10000.00' } },
        after: { totals: { planned: '12000.00' } },
      });
      await audit(runner, {
        table: 'spend_allocations', recordId: version, action: 'update', userId: reader.id,
        before: [{ id: randomUUID(), tenant_id: seedData.tenantId, version_id: version, company_id: seedData.companyA, allocation_pct: '100.00' }],
        after: [
          { id: randomUUID(), tenant_id: seedData.tenantId, version_id: version, company_id: seedData.companyA, allocation_pct: '60.00' },
          { id: randomUUID(), tenant_id: seedData.tenantId, version_id: version, company_id: seedData.companyB, allocation_pct: '40.00' },
        ],
      });
      const linkId = randomUUID();
      await audit(runner, {
        table: 'spend_links', recordId: linkId, action: 'create', userId: reader.id,
        after: { spend_item_id: line, url: 'https://example.invalid/spec', description: 'Spec link' },
      });
      await audit(runner, {
        table: 'spend_links', recordId: linkId, action: 'delete', userId: reader.id,
        before: { spend_item_id: line, url: 'https://example.invalid/spec', description: 'Spec link' },
        after: null,
      });
      const attachmentId = randomUUID();
      const attachment = { spend_item_id: line, original_filename: 'note.txt', mime_type: 'text/plain', size: 4 };
      await audit(runner, { table: 'spend_attachments', recordId: attachmentId, action: 'create', userId: reader.id, after: attachment });
      await audit(runner, { table: 'spend_attachments', recordId: attachmentId, action: 'update', userId: reader.id, before: attachment, after: null });
      const contactLinkId = randomUUID();
      const contactLink = { spend_item_id: line, contact_id: seedData.contact, role: 'commercial', origin: 'manual' };
      await audit(runner, {
        table: 'spend_item_contacts', recordId: contactLinkId, action: 'create', userId: reader.id,
        after: contactLink,
      });
      await audit(runner, {
        table: 'spend_item_contacts', recordId: contactLinkId, action: 'delete', userId: reader.id,
        before: contactLink, after: null,
      });
      await audit(runner, {
        table: 'spend_round_inputs', recordId: randomUUID(), action: 'create', userId: reader.id,
        after: {
          tenant_id: seedData.tenantId, version_id: version, measure: 'planned',
          period_start: '2026-01-01', period_end: '2026-12-31', method: 'manual', fte: '1.00',
        },
      });
      await audit(runner, {
        table: 'application_spend_items', recordId: line, action: 'update', userId: reader.id, parent: { table: 'spend_items', id: line },
        before: [], after: [seedData.application],
      });
      await audit(runner, {
        table: 'application_spend_items', recordId: line, action: 'update', userId: reader.id, parent: { table: 'spend_items', id: line },
        before: [seedData.application], after: [],
      });
      await audit(runner, {
        table: 'technology_spend_items', recordId: line, action: 'update', userId: reader.id, parent: { table: 'spend_items', id: line },
        before: [], after: [seedData.technology],
      });
      await audit(runner, {
        table: 'technology_spend_items', recordId: line, action: 'update', userId: reader.id, parent: { table: 'spend_items', id: line },
        before: [seedData.technology], after: [],
      });
      await audit(runner, {
        table: 'asset_spend_items', recordId: seedData.asset, action: 'update', userId: reader.id,
        parent: { table: 'spend_items', id: line },
        before: { ids: [] }, after: { ids: [line] },
      });
      await audit(runner, {
        table: 'asset_spend_items', recordId: seedData.asset, action: 'update', userId: reader.id,
        parent: { table: 'spend_items', id: line },
        before: { ids: [line] }, after: { ids: [] },
      });
      // A contract link written from the contract (record_id the contract, the payload the line).
      await audit(runner, {
        table: 'contract_spend_items', recordId: seedData.contractB, action: 'update', userId: reader.id,
        parent: { table: 'spend_items', id: line },
        before: { ids: [] }, after: { ids: [line] },
      });
      await audit(runner, {
        table: 'contract_spend_items', recordId: seedData.contractA, action: 'update', userId: reader.id,
        parent: { table: 'spend_items', id: line },
        before: { ids: [line] }, after: { ids: [] },
      });
      // Project and request links written from the line (record_id the line, the payload the other id).
      await audit(runner, {
        table: 'portfolio_project_opex', recordId: line, action: 'update', userId: reader.id,
        parent: { table: 'spend_items', id: line },
        before: [], after: [seedData.project],
      });
      await audit(runner, {
        table: 'portfolio_request_opex', recordId: line, action: 'update', userId: reader.id,
        parent: { table: 'spend_items', id: line },
        before: [], after: [seedData.request],
      });
      // The line's task, as the task writer saves it (`related_object_type` names the line).
      await audit(runner, {
        table: 'tasks', recordId: seedData.task, action: 'create', userId: reader.id,
        after: { related_object_type: 'spend_item', related_object_id: line, title: 'Follow up', item_number: 5 },
      });
      // `POST /spend-items/:id/tasks` writes the legacy label in the same call (`spend-tasks.service.ts`).
      await audit(runner, {
        table: 'spend_tasks', recordId: seedData.task, action: 'create', userId: reader.id,
        after: { related_object_type: 'spend_item', related_object_id: line, title: 'Follow up', item_number: 5 },
      });
      await audit(runner, {
        table: 'tasks', recordId: seedData.task, action: 'delete', userId: reader.id,
        before: { related_object_type: 'spend_item', related_object_id: line, title: 'Follow up', item_number: 5 }, after: null,
      });
      // The legacy task label, written beside the `tasks` row by the line task route: excluded.
      const taskUpdate = await audit(runner, {
        table: 'spend_tasks', recordId: seedData.task, action: 'update', userId: reader.id,
        before: null, after: { related_object_id: line, title: 'Follow up', item_number: 5, status: 'done' },
      });
      // The assistant replaces a whole set in one row: arrays of relation items, readable labels.
      const aiLink = await audit(runner, {
        table: 'spend_links', recordId: line, action: 'update', userId: reader.id, source: 'ai_chat',
        parent: { table: 'spend_items', id: line },
        before: [{ key: 'old', label: 'Old docs', payload: { url: 'https://example.invalid/old', description: 'Old docs' } }],
        after: [{ key: 'new', label: 'New docs', payload: { url: 'https://example.invalid/new', description: 'New docs' } }],
      });
      const aiContact = await audit(runner, {
        table: 'spend_item_contacts', recordId: line, action: 'update', userId: reader.id, source: 'ai_chat',
        before: [{ key: `${seedData.contact}:commercial:manual`, label: 'Cora Contact - commercial', payload: { contact_id: seedData.contact, role: 'commercial', origin: 'manual' } }],
        after: [{ key: `${seedData.contact}:technical:manual`, label: 'Cora Contact - technical', payload: { contact_id: seedData.contact, role: 'technical', origin: 'manual' } }],
      });
      await audit(runner, {
        table: 'spend_items', recordId: line, action: 'update', userId: reader.id,
        before: linePayload(seedData, line, { analytics_values: { [seedData.axis]: seedData.categoryA }, supplier_id: seedData.supplier, contract_id: seedData.contractA }),
        after: linePayload(seedData, line, { analytics_values: { [seedData.axis]: seedData.categoryB }, supplier_id: seedData.supplier, contract_id: seedData.contractB }),
      });
      // The four authors on the same line.
      await audit(runner, { table: 'spend_items', recordId: line, action: 'update', userId: null, source: 'system', before: { notes: 'a' }, after: { notes: 'b' } });
      await audit(runner, { table: 'spend_items', recordId: line, action: 'update', userId: reader.id, source: 'budget_file', before: { notes: 'b' }, after: { notes: 'c' } });
      await audit(runner, { table: 'spend_items', recordId: line, action: 'update', userId: reader.id, source: 'ai_chat', before: { notes: 'c' }, after: { notes: 'd' } });

      // CAPEX labels of the same physical family.
      const capex = seedData.capexLine;
      await audit(runner, {
        table: 'capex_items', recordId: capex, action: 'create', userId: reader.id,
        after: { id: capex, tenant_id: seedData.tenantId, item_number: 2, nature: 'capex', description: 'Capital line', currency: 'EUR', effective_start: '2026-01-01', paying_company_id: seedData.companyA },
      });
      await audit(runner, {
        table: 'capex_versions', recordId: seedData.capexVersion, action: 'create', userId: reader.id,
        after: { id: seedData.capexVersion, tenant_id: seedData.tenantId, spend_item_id: capex, version_name: 'Y2026', budget_year: YEAR },
      });
      await audit(runner, {
        table: 'capex_amounts', recordId: seedData.capexVersion, action: 'update', userId: reader.id,
        before: [], after: [{ id: randomUUID(), tenant_id: seedData.tenantId, version_id: seedData.capexVersion, period: '2026-01-01', planned: '200.00' }],
      });
      await audit(runner, {
        table: 'capex_amounts', recordId: seedData.capexVersion, action: 'update', userId: reader.id,
        before: [{ id: randomUUID(), tenant_id: seedData.tenantId, version_id: seedData.capexVersion, period: '2026-01-01', planned: '200.00' }],
        after: [
          { id: randomUUID(), tenant_id: seedData.tenantId, version_id: seedData.capexVersion, period: '2026-01-01', planned: '100.00' },
          { id: randomUUID(), tenant_id: seedData.tenantId, version_id: seedData.capexVersion, period: '2026-02-01', planned: '100.00' },
        ],
      });
      await audit(runner, {
        table: 'spend_allocations', recordId: seedData.capexVersion, action: 'update', userId: reader.id,
        before: { count: 1 }, after: { count: 2, operation: 'allocation_copy', sourceYear: 2025, destinationYear: 2026, overwrite: false },
      });
      await audit(runner, {
        table: 'capex_item_contacts', recordId: capex, action: 'update', userId: reader.id,
        before: [`${seedData.contact}:commercial`], after: [`${seedData.contact}:technical`],
      });
      await audit(runner, {
        table: 'capex_links', recordId: randomUUID(), action: 'create', userId: reader.id,
        after: { capex_item_id: capex, url: 'https://example.invalid/capex', description: 'Capital link' },
      });
      await audit(runner, {
        table: 'capex_attachments', recordId: randomUUID(), action: 'create', userId: reader.id,
        after: { capex_item_id: capex, original_filename: 'capex.txt' },
      });

      // The line that changed from OPEX to CAPEX keeps one row under each audit label.
      await audit(runner, {
        table: 'spend_items', recordId: seedData.typeLine, action: 'update', userId: reader.id,
        before: { nature: 'opex', description: 'Type line' }, after: { nature: 'capex', description: 'Type line' },
      });
      await audit(runner, {
        table: 'capex_items', recordId: seedData.typeLine, action: 'update', userId: reader.id,
        before: { nature: 'opex', description: 'Type line' }, after: { nature: 'capex', description: 'Type line' },
      });

      // 120 writes for the cursor: 3 pages of 50/50/20.
      for (let index = 0; index < 120; index += 1) {
        await audit(runner, {
          table: 'spend_items', recordId: seedData.pageLine, action: 'update', userId: reader.id,
          before: { notes: `before ${index}` }, after: { notes: `after ${index}` },
        });
      }

      // Three rows on their own line: the two newest present no change, the oldest does.
      const emptyOldest = await audit(runner, {
        table: 'spend_items', recordId: seedData.emptyPageLine, action: 'update', userId: reader.id,
        before: { notes: 'before empty page' }, after: { notes: 'after empty page' },
      });
      const emptyMiddle = await audit(runner, {
        table: 'spend_items', recordId: seedData.emptyPageLine, action: 'update', userId: reader.id,
        before: null, after: { operation: 'budget_file_import', year: YEAR, source: 'budget_file' },
      });
      const emptyNewest = await audit(runner, {
        table: 'spend_items', recordId: seedData.emptyPageLine, action: 'update', userId: reader.id,
        before: { row_version: 1 }, after: { row_version: 2 },
      });
      await runner.query(`UPDATE audit_log SET created_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [emptyOldest]);
      await runner.query(`UPDATE audit_log SET created_at = '2026-01-02T00:00:00Z' WHERE id = $1`, [emptyMiddle]);
      await runner.query(`UPDATE audit_log SET created_at = '2026-01-03T00:00:00Z' WHERE id = $1`, [emptyNewest]);

      const importRow = await audit(runner, {
        table: 'spend_items', recordId: line, action: 'update', userId: reader.id,
        before: null, after: { operation: 'budget_file_import', year: YEAR, source: 'budget_file' },
      });
      const copyRow = await audit(runner, {
        table: 'spend_versions', recordId: version, action: 'update', userId: reader.id,
        before: { allocation_method: 'manual_pct' },
        after: { allocation_method: 'manual_pct', operation: 'allocation_copy', sourceYear: 2025, destinationYear: YEAR },
      });
      return { seed: seedData, reader, noModules, limited, audits: { taskUpdate, aiLink, aiContact, importRow, copyRow } };
    });

    await testEntriesAndChildren(seeded);
    await testNaturesAndTypeChange(seeded);
    await testFlatAmounts(seeded);
    await testTechnicalChildren(seeded);
    await testPagination(seeded);
    await testEmptyPages(seeded);
    await testPermissionsAndAccess(seeded);
    await testReferences(seeded);
    await testUnknownChildLabel(seeded);
    await testAuthors(seeded);
    console.log('record-history.integration.spec: ok');
  } finally {
    await dropRaceTenant(tenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
