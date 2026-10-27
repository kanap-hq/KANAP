import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { addDaysYmd, addMonthsYmd, CONTRACT_TERM_STATES } from '../../contracts/contract-terms';

// Plaid and the MCP server read contracts as the Contracts list shows them (lot L1 of the Plaid and
// MCP quality pass, 2026-10-26), and what each contract covers.
//
// - query_entities on contracts: `term_state`, `next_due_date`, `cancellation_deadline`,
//   `current_term_end` and `renewed` of each item equal the Contracts list's
//   (`ContractsService.list`) for the same contract, one contract at least in each state, with the
//   tenant's decision window (45 days here) and a renewal already confirmed. The `term_state`
//   filter keeps the contracts of the list's "To decide" quick filter; a group by `term_state`
//   counts them; `next_due_date` sorts and filters as on the list; the owner filters by name.
// - The question of the site, "which contracts are to decide and which applications do they
//   cover", is one query: each item names its covered applications.
// - The `application` filter lists the contracts that cover an application (by reference or name).
// - get_entity_detail and get_entity_context on a contract: the applications, assets, technologies
//   and budget lines it covers, for a caller who reads each module. A caller who reads contracts
//   only gets none of them (null in the detail, no section in the context) and no name of them;
//   the `application` filter is not offered to them.
// The AI surface checks are not under test: stubbed open.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-contract-terms-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; executor: any; aggregates: any; entities: any; contracts: any };
type UserKey = 'full' | 'contractsOnly';

/** The seeded contracts, by name, with the state each must be in. */
const EXPECTED_STATES: Record<string, string> = {
  'Renewing to decide': 'to_decide',
  'Renewal confirmed': 'in_progress',
  'Ending to decide': 'to_decide',
  'Fresh renewing': 'in_progress',
  'Past its deadline': 'renewed',
  'Renewed once': 'in_progress',
  'Ending later': 'ending',
  'Expired': 'expired',
  // Its deadline is about 60 days away: to decide with the default window (90), not with 45.
  'Outside the window': 'in_progress',
};

/** Names a caller who reads contracts only must never get. */
const COVERED_NAMES = ['Billing', 'srv-billing', 'Postgres', 'Billing licences'];

type Seed = {
  tenantId: string;
  users: Record<UserKey, string>;
  contracts: Record<string, string>;
  application: string;
};

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-contract-terms.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { AiEntityService } = require('../ai-entity.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { ContractsService } = require('../../contracts/contracts.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  return {
    app,
    dataSource: app.get(DataSource),
    executor: app.get(AiQueryExecutor),
    aggregates: app.get(AiAggregateExecutor),
    entities: app.get(AiEntityService),
    contracts: app.get(ContractsService),
  };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"contracts":{"decision_window_days":45}}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-contract-terms-${tag}`, `ai-contract-terms-${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

  const role = async (name: string, resources: string[]) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, name]);
    for (const resource of resources) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'reader')`, [tenantId, id, resource]);
    }
    return id;
  };
  const user = async (key: string, roleId: string) => insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled')`,
    [tenantId, `${key}-${tag}@example.test`, key, roleId]);
  const users = {
    full: await user('Full', await role('Everything', ['applications', 'infrastructure', 'budget', 'contracts'])),
    contractsOnly: await user('Contracts', await role('Contracts only', ['contracts'])),
  };

  const company = await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Company', 'FR', 'Paris')`, [tenantId]);
  const supplier = await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Supplier')`, [tenantId]);
  const today = new Date().toISOString().slice(0, 10);
  const months = (n: number) => addMonthsYmd(today, n);
  const definitions: Array<[string, string, number, number, boolean]> = [
    // name, start, duration (months), notice (months), tacit renewal
    ['Renewing to decide', months(-10), 12, 1, true],
    ['Renewal confirmed', months(-10), 12, 1, true],
    ['Ending to decide', months(-11), 12, 0, false],
    ['Fresh renewing', months(-1), 12, 1, true],
    ['Past its deadline', months(-11), 12, 1, true],
    ['Renewed once', months(-14), 12, 1, true],
    ['Ending later', months(-1), 12, 0, false],
    ['Expired', months(-24), 12, 0, false],
    ['Outside the window', months(-9), 12, 1, true],
  ];
  const contracts: Record<string, string> = {};
  for (const [name, start, duration, notice, renewal] of definitions) {
    contracts[name] = await insertId(runner,
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, notice_period_months, auto_renewal, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tenantId, name, company, supplier, start, duration, notice, renewal, name === 'Ending to decide' ? users.full : null]);
  }
  // A renewal confirmed for the first term (its last day: the start plus 12 months, less a day),
  // as `ContractRenewalService` records it: out of "to decide".
  const confirmedTermEnd = addDaysYmd(addMonthsYmd(months(-10), 12), -1);
  await runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, after_json, source, source_ref)
     VALUES ($1, 'contracts', $2, 'update', $3::jsonb, 'user', $4)`,
    [tenantId, contracts['Renewal confirmed'], JSON.stringify({ renewal_decision: { decision: 'renew' } }), `contract-renewal:${confirmedTermEnd}`],
  );

  const application = await insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'Billing', 'APP-1', 'enabled')`, [tenantId]);
  const other = await insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'Payroll', 'APP-10', 'enabled')`, [tenantId]);
  const asset = await insertId(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'srv-billing', 'server', 'prod')`, [tenantId]);
  const technology = await insertId(runner,
    `INSERT INTO technologies (tenant_id, name, item_number) VALUES ($1, 'Postgres', 1)`, [tenantId]);
  const line = await insertId(runner,
    `INSERT INTO spend_items (tenant_id, nature, product_name, currency, effective_start, item_number, paying_company_id)
     VALUES ($1, 'opex', 'Billing licences', 'EUR', '2026-01-01', 1, $2)`,
    [tenantId, company]);
  for (const name of ['Renewing to decide', 'Ending to decide']) {
    await runner.query(`INSERT INTO application_contracts (tenant_id, application_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, application, contracts[name]]);
  }
  await runner.query(`INSERT INTO application_contracts (tenant_id, application_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, other, contracts['Fresh renewing']]);
  const covered = contracts['Renewing to decide'];
  await runner.query(`INSERT INTO asset_contracts (tenant_id, asset_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, asset, covered]);
  await runner.query(`INSERT INTO technology_contracts (tenant_id, technology_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, technology, covered]);
  await runner.query(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, covered, line]);

  return { tenantId, users, contracts, application };
}

function ctx(runner: QueryRunner, s: Seed, user: UserKey) {
  return {
    tenantId: s.tenantId,
    userId: s.users[user],
    isPlatformHost: false,
    surface: 'mcp' as const,
    authMethod: 'api_key' as const,
    manager: runner.manager,
  };
}

/** The Contracts list for a filter model, as the page asks for it. */
async function screenList(h: Harness, runner: QueryRunner, filters?: Record<string, unknown>, sort?: string): Promise<any[]> {
  const query: Record<string, unknown> = { page: 1, limit: 100 };
  if (filters) query.filters = JSON.stringify(filters);
  if (sort) query.sort = sort;
  return (await h.contracts.list(query, { manager: runner.manager })).items;
}

/**
 * The calendar day of an aggregate's date value. The aggregates hand a `date` column over as the
 * text of its JavaScript date (local midnight), whatever the family: compared by its day.
 */
function calendarDay(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const names = (items: Array<{ label?: string; name?: string }>) => items.map((item) => item.label ?? item.name).sort();
const TERM_FIELDS = ['term_state', 'next_due_date', 'cancellation_deadline', 'current_term_end', 'renewed'] as const;

async function testParity(h: Harness, runner: QueryRunner, s: Seed) {
  const full = ctx(runner, s, 'full');
  const screen = await screenList(h, runner);
  const assistant = await h.executor.execute(full, { entity_type: 'contracts', limit: 100 });
  assert.equal(assistant.total, screen.length, 'the same contracts');
  const byId = new Map<string, any>(assistant.items.map((item: any) => [item.id, item]));
  for (const row of screen) {
    const item = byId.get(row.id);
    assert.ok(item, `${row.name}: listed by the assistant`);
    for (const field of TERM_FIELDS) {
      assert.equal(item.metadata[field], row[field] ?? null, `${row.name}: ${field} as on the Contracts list`);
    }
    assert.equal(row.term_state, EXPECTED_STATES[row.name], `${row.name}: the seeded state`);
  }
  assert.deepEqual(
    [...new Set(screen.map((row) => row.term_state))].sort(),
    [...CONTRACT_TERM_STATES].sort(),
    'every state is covered',
  );
  assert.equal(byId.get(s.contracts['Ending to decide']).metadata.owner, 'Full Tester', 'the owner, by name');

  // The "To decide" quick filter of the list, and the same filter through the assistant.
  const toDecide = await screenList(h, runner, { term_state: { filterType: 'set', values: ['to_decide'] } });
  const filtered = await h.executor.execute(full, { entity_type: 'contracts', filters: { term_state: ['to_decide'] } });
  assert.deepEqual(names(filtered.items), names(toDecide), 'term_state to_decide keeps the list\'s "To decide" contracts');
  assert.deepEqual(names(filtered.items), ['Ending to decide', 'Renewing to decide']);

  // A group by state counts what the list shows.
  const groups = await h.aggregates.execute(full, { entity_type: 'contracts', group_by: 'term_state' });
  const counted = Object.fromEntries(groups.groups.map((group: any) => [group.key, group.count]));
  const expected: Record<string, number> = {};
  for (const row of screen) expected[row.term_state] = (expected[row.term_state] ?? 0) + 1;
  assert.deepEqual(counted, expected, 'aggregate by term_state');
  const renewedGroups = await h.aggregates.execute(full, { entity_type: 'contracts', group_by: 'renewed' });
  assert.equal(renewedGroups.groups.find((group: any) => group.key === 'true')?.count, screen.filter((row) => row.renewed).length, 'aggregate by renewed');
  const earliest = await h.aggregates.execute(full, { entity_type: 'contracts', group_by: 'term_state', metric: 'next_due_date', function: 'min' });
  const toDecideMin = toDecide.map((row) => row.next_due_date).sort()[0];
  assert.equal(calendarDay(earliest.groups.find((group: any) => group.key === 'to_decide')?.value), toDecideMin, 'min next_due_date of the contracts to decide');

  // next_due_date sorts and filters as on the list.
  const sortedScreen = await screenList(h, runner, undefined, 'next_due_date:ASC');
  const sorted = await h.executor.execute(full, { entity_type: 'contracts', limit: 100, sort: { field: 'next_due_date', direction: 'asc' } });
  assert.deepEqual(sorted.items.map((item: any) => item.id), sortedScreen.map((row) => row.id), 'next_due_date ascending, as the list');
  const horizon = addDaysYmd(new Date().toISOString().slice(0, 10), 90);
  const due = await h.executor.execute(full, { entity_type: 'contracts', limit: 100, filters: { next_due_date: { op: 'before', value: horizon } } });
  const dueScreen = await screenList(h, runner, { next_due_date: { filterType: 'date', type: 'lessThan', dateFrom: horizon } });
  assert.deepEqual(names(due.items), names(dueScreen), 'next_due_date before a date, as the list');
  const cancelSorted = await h.executor.execute(full, { entity_type: 'contracts', limit: 100, sort: { field: 'cancellation_deadline', direction: 'asc' } });
  assert.deepEqual(cancelSorted.items.map((item: any) => item.id), (await screenList(h, runner, undefined, 'cancellation_deadline:ASC')).map((row) => row.id), 'cancellation_deadline ascending, as the list');

  const owned = await h.executor.execute(full, { entity_type: 'contracts', filters: { owner: ['Full Tester'] } });
  assert.deepEqual(names(owned.items), ['Ending to decide'], 'the owner filter');
  console.log('  terms: the values, the state filter, the groups and the sorts of the Contracts list: OK');
}

async function testCoverage(h: Harness, runner: QueryRunner, s: Seed) {
  const full = ctx(runner, s, 'full');
  const only = ctx(runner, s, 'contractsOnly');

  // The question of the site in one call.
  const answer = await h.executor.execute(full, { entity_type: 'contracts', filters: { term_state: ['to_decide'] } });
  assert.deepEqual(
    answer.items.map((item: any) => [item.label, item.metadata.covered_applications]).sort(),
    [['Ending to decide', 'APP-1 Billing'], ['Renewing to decide', 'APP-1 Billing']],
    'the contracts to decide name the applications they cover',
  );
  const all = await h.executor.execute(full, { entity_type: 'contracts', limit: 100 });
  assert.equal(all.items.find((item: any) => item.label === 'Expired').metadata.covered_applications, '', 'no application: an empty line');

  // The contracts that cover an application, by reference or by name; APP-1 is not APP-10.
  for (const value of ['APP-1', 'app-1', 'billing']) {
    const covering = await h.executor.execute(full, { entity_type: 'contracts', filters: { application: [value] } });
    assert.equal(covering.status, undefined, `application ${value}: applied`);
    assert.deepEqual(names(covering.items), ['Ending to decide', 'Renewing to decide'], `the contracts covering ${value}`);
  }
  const groupedCovering = await h.aggregates.execute(full, { entity_type: 'contracts', group_by: 'term_state', filters: { application: ['APP-1'] } });
  assert.deepEqual(groupedCovering.groups, [{ key: 'to_decide', count: 2 }], 'the application filter in an aggregate');

  // Detail and context, with every right.
  const detail = await h.executor.executeDetail(full, { entity_type: 'contracts', entity_id: s.contracts['Renewing to decide'] });
  assert.deepEqual(detail.data.linked_applications.items.map((item: any) => [item.reference, item.name]), [['APP-1', 'Billing']], 'detail: the covered application');
  assert.deepEqual(detail.data.linked_assets.items.map((item: any) => item.name), ['srv-billing'], 'detail: the covered asset');
  assert.deepEqual(detail.data.linked_technologies.items.map((item: any) => [item.reference, item.name]), [['TEC-1', 'Postgres']], 'detail: the covered technology');
  assert.equal(detail.data.linked_spend_items.length, 1, 'detail: the budget line');
  assert.equal(detail.data.budget_lines_outside_access, 0, 'detail: no line outside the access');
  assert.equal(detail.entity.metadata.covered_applications, 'APP-1 Billing', 'detail summary: the covered applications');
  assert.equal(detail.entity.metadata.term_state, 'to_decide', 'detail summary: the state');
  const context = await h.entities.getEntityContext(full, { entity_type: 'contracts', entity_id: s.contracts['Renewing to decide'] });
  const relations = (result: any) => result.related.map((group: any) => group.relation).sort();
  assert.deepEqual(relations(context), ['budget_lines', 'covered_applications', 'covered_assets', 'covered_technologies'], 'context: every family');
  assert.equal(context.related.find((group: any) => group.relation === 'covered_applications').items[0].ref, 'APP-1', 'context: the application reference');
  assert.equal(context.related.find((group: any) => group.relation === 'budget_lines').items[0].ref, 'BL-1', 'context: the line reference');
  assert.equal(context.entity.metadata.term_state, 'to_decide', 'context: the state');
  assert.equal(context.entity.metadata.next_due_date, detail.entity.metadata.next_due_date, 'context: the next due date');

  // A caller who reads contracts only.
  const hiddenList = await h.executor.execute(only, { entity_type: 'contracts', filters: { term_state: ['to_decide'] } });
  assert.deepEqual(names(hiddenList.items), ['Ending to decide', 'Renewing to decide'], 'contracts only: the same contracts to decide');
  for (const item of hiddenList.items) assert.equal(item.metadata.covered_applications, null, 'contracts only: no covered applications (null, not empty)');
  const refused = await h.executor.execute(only, { entity_type: 'contracts', filters: { application: ['APP-1'] } });
  assert.equal(refused.status, 'invalid_filter', 'contracts only: the application filter is not offered');
  const hiddenDetail = await h.executor.executeDetail(only, { entity_type: 'contracts', entity_id: s.contracts['Renewing to decide'] });
  for (const key of ['linked_applications', 'linked_assets', 'linked_technologies', 'linked_spend_items', 'linked_capex_items', 'budget_lines_outside_access']) {
    assert.equal(hiddenDetail.data[key], null, `contracts only: ${key} is null`);
  }
  assert.equal(hiddenDetail.entity.metadata.covered_applications, null, 'contracts only: no covered applications in the summary');
  const hiddenContext = await h.entities.getEntityContext(only, { entity_type: 'contracts', entity_id: s.contracts['Renewing to decide'] });
  assert.deepEqual(hiddenContext.related, [], 'contracts only: no section');
  assert.equal(hiddenContext.entity.metadata.budget_lines_outside_access, undefined, 'contracts only: no line count');
  for (const [label, value] of [['list', hiddenList], ['detail', hiddenDetail], ['context', hiddenContext]] as const) {
    const text = JSON.stringify(value);
    for (const name of COVERED_NAMES) assert.ok(!text.includes(name), `contracts only, ${label}: ${name} is not shown`);
  }
  console.log('  coverage: the site question in one call, the application filter, detail and context by right: OK');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testParity(harness, runner, s);
      await testCoverage(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-contract-terms.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
