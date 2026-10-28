// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import {
  RecordHistoryService,
  type RecordHistoryContext,
  type RecordHistoryItem,
  type RecordHistoryPage,
} from '../record-history.service';
import {
  seedHistoryData,
  seedPerson,
  seedPilotAudits,
  type HistorySeed,
  type Person,
} from './record-history.fixtures';

// The two pilot records of lot 2: an account and a cost center read their history through the
// same route as a budget line. The record check is the reference family's own visibility rule
// (tenant, RLS, module), a missing, unknown or foreign record is 404, a person without the
// record's module is 403, and a reference to another module is hidden when the reader cannot read
// it. The fields are the allow-list's: a creation and a modification read in words, never a payload.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

async function readPage(
  person: Person,
  tenantId: string,
  table: string,
  id: string,
  permissions: Record<string, string>,
): Promise<RecordHistoryPage> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const ctx: RecordHistoryContext = {
      tenantId,
      userId: person.id,
      isAdmin: false,
      permissions,
      manager: runner.manager,
    };
    return await new RecordHistoryService().list(ctx, table, id);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

function findItem(page: RecordHistoryPage, action: string): RecordHistoryItem {
  const item = page.items.find((candidate) => candidate.action === action && candidate.subject.kind === 'record');
  assert.ok(item, `a ${action} entry of the record`);
  return item;
}

function findChange(item: RecordHistoryItem, field: string) {
  const change = item.changes.find((candidate) => candidate.field === field);
  assert.ok(change, `${field}: the field is presented`);
  return change;
}

function assertNoField(page: RecordHistoryPage, field: string) {
  assert.equal(
    page.items.some((item) => item.changes.some((change) => change.field === field)),
    false,
    `${field}: a hidden field never becomes a change`,
  );
}

/** Every value is a scalar, a resolved reference or a hidden one: never a raw payload. */
function assertPresentable(page: RecordHistoryPage) {
  for (const item of page.items) {
    for (const change of item.changes) {
      for (const value of [change.before, change.after]) {
        if (value === null || value === undefined || typeof value !== 'object') continue;
        assert.ok(
          (value as any).hidden === true || typeof (value as any).kind === 'string',
          `${change.field}: a structured value is a reference`,
        );
      }
    }
  }
  const serialized = JSON.stringify(page);
  for (const raw of ['after_json', 'before_json', 'tenant_id', 'created_at', 'updated_at', 'row_version']) {
    assert.ok(!serialized.includes(`"${raw}"`), `${raw}: no raw payload key`);
  }
}

async function testAccess(seeded: {
  data: HistorySeed;
  accountReader: Person;
  costReader: Person;
  allReader: Person;
}, foreign: HistorySeed) {
  const { data } = seeded;
  const accounts = { accounts: 'reader' };
  const costCenters = { cost_centers: 'reader' };
  const both = { accounts: 'reader', cost_centers: 'reader', companies: 'reader' };

  const account = await readPage(seeded.accountReader, data.tenantId, 'accounts', data.account, accounts);
  assert.ok(account.items.length >= 2, 'an accounts reader reads the account history');

  const costCenter = await readPage(seeded.costReader, data.tenantId, 'cost_centers', data.costCenterA, costCenters);
  assert.ok(costCenter.items.length >= 2, 'a cost-centers reader reads the cost center history');

  await assert.rejects(
    () => readPage(seeded.accountReader, data.tenantId, 'cost_centers', data.costCenterA, accounts),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'an accounts reader without cost_centers gets 403 MODULE_RIGHT_REQUIRED',
  );
  await assert.rejects(
    () => readPage(seeded.costReader, data.tenantId, 'accounts', data.account, costCenters),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'a cost-centers reader without accounts gets 403 MODULE_RIGHT_REQUIRED',
  );
  await assert.rejects(
    () => readPage(seeded.accountReader, data.tenantId, 'unknown_table', data.account, accounts),
    (error: any) => error?.status === 404,
    'an unknown table gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.accountReader, data.tenantId, 'accounts', 'not-a-uuid', accounts),
    (error: any) => error?.status === 404,
    'a malformed id gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.accountReader, data.tenantId, 'accounts', randomUUID(), accounts),
    (error: any) => error?.status === 404,
    'a missing account gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.allReader, data.tenantId, 'accounts', foreign.account, both),
    (error: any) => error?.status === 404,
    'an account of another tenant gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.allReader, data.tenantId, 'cost_centers', foreign.costCenterA, both),
    (error: any) => error?.status === 404,
    'a cost center of another tenant gets 404',
  );
  console.log('  200 with the module, 403 without it, 404 for unknown, missing and foreign records: OK');
}

async function testAccountEntries(seeded: { data: HistorySeed; allReader: Person }) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, 'accounts', data.account, {
    accounts: 'reader',
    companies: 'reader',
  });
  assertPresentable(page);

  const create = findItem(page, 'create');
  assert.equal(create.actor.kind, 'user');
  assert.equal(create.actor.name, 'Ava Reader');
  assert.equal(findChange(create, 'account_number').after, '4010');
  assert.equal(findChange(create, 'account_name').after, 'Software');
  assert.equal(findChange(create, 'status').after, 'enabled');
  const chart = findChange(create, 'coa_id').after as any;
  assert.equal(chart.kind, 'chart_of_accounts');
  assert.equal(chart.label, 'FR · Local chart');
  assert.equal(chart.id, data.coa);

  const update = findItem(page, 'update');
  assert.equal(findChange(update, 'account_name').before, 'Software');
  assert.equal(findChange(update, 'account_name').after, 'Software and services');
  assert.equal(findChange(update, 'status').before, 'enabled');
  assert.equal(findChange(update, 'status').after, 'disabled');
  assert.equal(findChange(update, 'nature').after, 'opex');
  assert.equal(findChange(update, 'consolidation_account_number').after, 1300);
  assert.equal(findChange(update, 'consolidation_account_name').after, 'Group software');
  assert.equal(findChange(update, 'consolidation_account_description').after, 'Group-wide software account');
  assert.equal(findChange(update, 'disabled_at').after, '2026-06-30T00:00:00.000Z');
  for (const field of ['id', 'tenant_id', 'created_at', 'updated_at']) assertNoField(page, field);
  assert.ok(!JSON.stringify(page).includes(data.tenantId), 'the tenant id never reaches the answer');
  console.log('  account creation and modification in words, chart named, hidden columns dropped: OK');
}

async function testCostCenterEntries(seeded: { data: HistorySeed; costReader: Person; allReader: Person }) {
  const { data } = seeded;
  const page = await readPage(seeded.costReader, data.tenantId, 'cost_centers', data.costCenterA, {
    cost_centers: 'reader',
  });
  assertPresentable(page);

  const create = findItem(page, 'create');
  assert.equal(findChange(create, 'code').after, 'CC-A');
  assert.equal(findChange(create, 'kind').after, 'cost_center');
  assert.equal(findChange(create, 'name').after, 'Centre A');
  const parent = findChange(create, 'parent_id').after as any;
  assert.equal(parent.kind, 'cost_center');
  assert.equal(parent.label, 'CC-B · Centre B');
  const owner = findChange(create, 'owner_user_id').after as any;
  assert.equal(owner.kind, 'user');
  assert.equal(owner.label, 'Ava Reader');
  assert.deepEqual(findChange(create, 'company_id').after, { hidden: true, kind: 'company' });
  assert.ok(!JSON.stringify(page).includes('Alpha Co'), 'a company the reader cannot read is not named');

  const update = findItem(page, 'update');
  assert.equal(findChange(update, 'kind').before, 'cost_center');
  assert.equal(findChange(update, 'kind').after, 'group');
  assert.equal((findChange(update, 'parent_id').before as any).label, 'CC-B · Centre B');
  assert.equal(findChange(update, 'parent_id').after, null);
  assert.equal(findChange(update, 'description').after, 'Shared costs');
  assert.equal(findChange(update, 'disabled_at').after, '2026-07-31T00:00:00.000Z');
  assertNoField(page, 'sort_order');

  // The same entry, read by a person who also reads companies: the reference is named.
  const full = await readPage(seeded.allReader, data.tenantId, 'cost_centers', data.costCenterA, {
    accounts: 'reader',
    cost_centers: 'reader',
    companies: 'reader',
  });
  const fullCreate = findItem(full, 'create');
  const company = findChange(fullCreate, 'company_id').after as any;
  assert.equal(company.kind, 'company');
  assert.equal(company.label, 'Alpha Co');
  console.log('  cost-center creation and modification in words, parent and owner named, company hidden by module: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-pilots');
  const foreignTenantId = await createRaceTenant('record-history-pilots-foreign');
  try {
    const seeded = await seed(tenantId, async (runner) => {
      const data = await seedHistoryData(runner, tenantId);
      await seedPilotAudits(runner, data);
      const accountReader = await seedPerson(runner, tenantId, { first: 'Aline', last: 'Account' }, { accounts: 'reader' });
      const costReader = await seedPerson(runner, tenantId, { first: 'Cesar', last: 'Cost' }, { cost_centers: 'reader' });
      const allReader = await seedPerson(
        runner,
        tenantId,
        { first: 'Alba', last: 'All' },
        { accounts: 'reader', cost_centers: 'reader', companies: 'reader' },
      );
      return { data, accountReader, costReader, allReader };
    });
    const foreign = await seed(foreignTenantId, (runner) => seedHistoryData(runner, foreignTenantId));

    await testAccess(seeded, foreign);
    await testAccountEntries(seeded);
    await testCostCenterEntries(seeded);
    console.log('record-history-pilots.integration.spec: ok');
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
