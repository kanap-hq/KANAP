import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// The assistant's and the MCP server's read tools show the records linked to a record only to a
// caller who reads their module, as the record's page does (review of 2026-10-23: an IT landscape
// reader got an application's budget lines and contracts through get_entity_detail).
//
// - get_entity_detail on an application or an asset: the OPEX and CAPEX lines need the budget
//   right, the contracts the contracts right, the projects the projects right. Without it, the
//   list and its count are null (never 0) and the relation total leaves them out.
// - get_entity_detail on a budget line or a contract: the same rule for the linked
//   applications, projects, contracts and budget lines.
// - query_entities, aggregate_entities and describe_entity_filters on applications: budget_lines_count
//   and contracts_count are null and neither filter, sort nor aggregate without the right.
// - get_entity_context on an application or an asset: no section of a family the caller does not read.
// A caller with every right gets all of it. The AI surface checks are not under test: stubbed open.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-linked-read-rights-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; executor: any; aggregates: any; entities: any; tools: any };

type UserKey = 'landscape' | 'full' | 'budgetOnly' | 'contractsOnly';

type Seed = {
  tenantId: string;
  users: Record<UserKey, string>;
  application: string;
  asset: string;
  opex: string;
  capex: string;
  contract: string;
};

/** Names that must never reach a caller without the right. */
const LINKED_NAMES = ['Secret OPEX line', 'Secret CAPEX line', 'Secret contract', 'Secret project'];

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-linked-read-rights.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { AiEntityService } = require('../ai-entity.service');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiPolicyService } = require('../ai-policy.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // The surface checks (tenant AI settings, provider, subscription) are not what this spec tests.
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  return {
    app,
    dataSource: app.get(DataSource),
    executor: app.get(AiQueryExecutor),
    aggregates: app.get(AiAggregateExecutor),
    entities: app.get(AiEntityService),
    tools: app.get(AiToolRegistry),
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
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-linked-${tag}`, `ai-linked-${tag}`],
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
    landscape: await user('Landscape', await role('IT Landscape Reader', ['applications', 'infrastructure'])),
    full: await user('Full', await role('Everything', ['applications', 'infrastructure', 'budget', 'contracts', 'portfolio_projects'])),
    budgetOnly: await user('Budget', await role('Budget only', ['budget'])),
    contractsOnly: await user('Contracts', await role('Contracts only', ['contracts'])),
  };

  const company = await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Company', 'FR', 'Paris')`, [tenantId]);
  const supplier = await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Supplier')`, [tenantId]);
  const line = (nature: 'opex' | 'capex', name: string, itemNumber: number) => insertId(runner,
    `INSERT INTO spend_items (tenant_id, nature, product_name, currency, effective_start, item_number, paying_company_id)
     VALUES ($1, $2, $3, 'EUR', '2026-01-01', $4, $5)`,
    [tenantId, nature, name, itemNumber, company]);
  const opex = await line('opex', 'Secret OPEX line', 1);
  const capex = await line('capex', 'Secret CAPEX line', 2);
  const contract = await insertId(runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Secret contract', $2, $3, '2026-01-01')`,
    [tenantId, company, supplier]);
  const project = await insertId(runner,
    `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Secret project', 1)`, [tenantId]);
  const application = await insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'Billing', 'APP-1', 'enabled')`, [tenantId]);
  const asset = await insertId(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'srv-billing', 'server', 'prod')`, [tenantId]);

  for (const lineId of [opex, capex]) {
    await runner.query(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, application, lineId]);
    await runner.query(`INSERT INTO asset_spend_items (tenant_id, asset_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, asset, lineId]);
    await runner.query(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, contract, lineId]);
  }
  await runner.query(`INSERT INTO application_contracts (tenant_id, application_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, application, contract]);
  await runner.query(`INSERT INTO asset_contracts (tenant_id, asset_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, asset, contract]);
  await runner.query(`INSERT INTO application_projects (tenant_id, application_id, project_id) VALUES ($1, $2, $3)`, [tenantId, application, project]);
  await runner.query(`INSERT INTO asset_projects (tenant_id, asset_id, project_id) VALUES ($1, $2, $3)`, [tenantId, asset, project]);

  return { tenantId, users, application, asset, opex, capex, contract };
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

const items = (value: any) => (value?.items ?? []).length;

function assertNoLinkedName(value: unknown, label: string) {
  const text = JSON.stringify(value);
  for (const name of LINKED_NAMES) assert.ok(!text.includes(name), `${label}: ${name} is not shown`);
}

async function testApplicationDetail(h: Harness, runner: QueryRunner, s: Seed) {
  const hidden = await h.executor.executeDetail(ctx(runner, s, 'landscape'), { entity_type: 'applications', entity_id: 'APP-1' });
  for (const key of ['linked_budget_lines', 'linked_contracts', 'projects']) {
    assert.equal(hidden.data[key], null, `landscape reader: no ${key}`);
  }
  for (const key of ['budget_lines_count', 'contracts_count']) {
    assert.equal(hidden.data[key], null, `landscape reader: no ${key} in the data`);
    assert.equal(hidden.entity.metadata[key], null, `landscape reader: no ${key} in the summary`);
  }
  const counts = hidden.data.relation_counts;
  assert.deepEqual(
    { budget_lines: counts.budget_lines, contracts: counts.contracts, projects: counts.projects, total: counts.total },
    { budget_lines: null, contracts: null, projects: null, total: 0 },
    'landscape reader: the relation counts leave the unread modules out',
  );
  assertNoLinkedName(hidden, 'landscape reader, application detail');

  const shown = await h.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'applications', entity_id: 'APP-1' });
  assert.equal(items(shown.data.linked_budget_lines), 2, 'full reader: both budget lines');
  assert.deepEqual(shown.data.linked_budget_lines.items.map((line: any) => [line.product_name, line.nature]), [
    ['Secret OPEX line', 'opex'], ['Secret CAPEX line', 'capex'],
  ], 'full reader: each line with its nature');
  assert.equal(items(shown.data.linked_contracts), 1, 'full reader: the contract');
  assert.equal(items(shown.data.projects), 1, 'full reader: the project');
  assert.deepEqual(
    [shown.entity.metadata.budget_lines_count, shown.entity.metadata.contracts_count],
    [2, 1],
    'full reader: the counts',
  );
  assert.equal(shown.data.relation_counts.projects, 1);
  assert.equal('opex' in counts, false, 'no per-nature alias in the relation counts');
  assert.equal('capex' in counts, false, 'no per-nature alias in the relation counts');
  assert.equal(shown.data.relation_counts.budget_lines, 2, 'both budget lines');
  assert.equal(shown.data.relation_counts.total, 4, 'two budget lines, the contract and the project');
}

async function testAssetDetail(h: Harness, runner: QueryRunner, s: Seed) {
  const hidden = await h.executor.executeDetail(ctx(runner, s, 'landscape'), { entity_type: 'assets', entity_id: s.asset });
  for (const key of ['linked_budget_lines', 'linked_contracts', 'projects']) {
    assert.equal(hidden.data[key], null, `landscape reader: no ${key} on the asset`);
  }
  assertNoLinkedName(hidden, 'landscape reader, asset detail');

  const shown = await h.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'assets', entity_id: s.asset });
  for (const key of ['linked_budget_lines', 'linked_contracts', 'projects']) {
    assert.equal(items(shown.data[key]), key === 'linked_budget_lines' ? 2 : 1, `full reader: ${key} on the asset`);
  }
}

async function testBudgetAndContractDetails(h: Harness, runner: QueryRunner, s: Seed) {
  const opex = await h.executor.executeDetail(ctx(runner, s, 'budgetOnly'), { entity_type: 'budget_lines', entity_id: s.opex });
  assert.equal(opex.data.linked_applications, null, 'budget only: no application on the OPEX line');
  assert.equal(opex.data.linked_contracts, null, 'budget only: no contract on the OPEX line');
  assert.equal(opex.data.projects, null, 'budget only: no project on the OPEX line');
  const capex = await h.executor.executeDetail(ctx(runner, s, 'budgetOnly'), { entity_type: 'budget_lines', entity_id: s.capex });
  assert.equal(capex.data.linked_applications, null, 'budget only: no application on the CAPEX line');
  assert.equal(capex.data.linked_contracts, null, 'budget only: no contract on the CAPEX line');

  const contract = await h.executor.executeDetail(ctx(runner, s, 'contractsOnly'), { entity_type: 'contracts', entity_id: s.contract });
  assert.equal(contract.data.linked_budget_lines, null, 'contracts only: no budget line on the contract');
  assert.ok(!/Secret (OPEX|CAPEX) line/.test(JSON.stringify(contract)), 'contracts only: no line name');

  const fullOpex = await h.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'budget_lines', entity_id: s.opex });
  assert.equal(items(fullOpex.data.linked_applications), 1, 'full reader: the application on the OPEX line');
  assert.equal(items(fullOpex.data.linked_contracts), 1, 'full reader: the contract on the OPEX line');
  const fullContract = await h.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'contracts', entity_id: s.contract });
  assert.equal(items(fullContract.data.linked_budget_lines), 2, 'full reader: both budget lines on the contract');
  assert.deepEqual(fullContract.data.linked_budget_lines.items.map((line: any) => line.nature).sort(), ['capex', 'opex'], 'each with its nature');
}

/** Refused, in a savepoint so a failed statement does not end the transaction. */
async function rejects(runner: QueryRunner, fn: () => Promise<unknown>, pattern: RegExp, label: string) {
  await runner.query('SAVEPOINT expected_failure');
  try {
    await fn();
    assert.fail(`${label}: should fail`);
  } catch (error: any) {
    if (error?.code === 'ERR_ASSERTION') throw error;
    assert.match(String(error?.message ?? error), pattern, label);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

async function testApplicationList(h: Harness, runner: QueryRunner, s: Seed) {
  const landscape = ctx(runner, s, 'landscape');
  const list = await h.executor.execute(landscape, { entity_type: 'applications' });
  const [row] = list.items;
  assert.deepEqual([row.metadata.budget_lines_count, row.metadata.contracts_count], [null, null], 'landscape reader: no count in the list');
  for (const field of ['budget_lines_count', 'contracts_count']) {
    const filtered = await h.executor.execute(landscape, { entity_type: 'applications', filters: { [field]: { op: 'gte', value: 1 } } });
    assert.equal(filtered.status, 'invalid_filter', `landscape reader: ${field} does not filter`);
    const sorted = await h.executor.execute(landscape, { entity_type: 'applications', sort: { field, direction: 'desc' } });
    assert.deepEqual(sorted.sort_ignored, [field], `landscape reader: ${field} does not sort`);
    await rejects(runner, () => h.aggregates.execute(landscape, { entity_type: 'applications', group_by: 'status', metric: field, function: 'sum' }),
      /Unsupported metric/, `landscape reader: ${field} does not aggregate`);
  }
  const description = await h.tools.execute(landscape, 'describe_entity_filters', { entity_type: 'applications' });
  assert.ok(!/budget_lines_count|contracts_count/.test(JSON.stringify(description)), 'landscape reader: the counts are not described');

  const full = ctx(runner, s, 'full');
  const shown = await h.executor.execute(full, { entity_type: 'applications', filters: { budget_lines_count: { op: 'gte', value: 2 } } });
  assert.equal(shown.status, undefined, 'full reader: budget_lines_count filters');
  assert.deepEqual([shown.items[0].metadata.budget_lines_count, shown.items[0].metadata.contracts_count], [2, 1]);
  const total = await h.aggregates.execute(full, { entity_type: 'applications', group_by: 'status', metric: 'contracts_count', function: 'sum' });
  assert.ok(JSON.stringify(total).includes('1'), 'full reader: contracts_count aggregates');
}

async function testContexts(h: Harness, runner: QueryRunner, s: Seed) {
  const relations = (result: any) => result.related.map((group: any) => group.relation).sort();
  const hidden = await h.entities.getEntityContext(ctx(runner, s, 'landscape'), { entity_type: 'applications', entity_id: 'APP-1' });
  assert.ok(!relations(hidden).includes('linked_projects'), 'landscape reader: no project section on the application');
  assertNoLinkedName(hidden, 'landscape reader, application context');
  const hiddenAsset = await h.entities.getEntityContext(ctx(runner, s, 'landscape'), { entity_type: 'assets', entity_id: s.asset });
  assert.ok(!relations(hiddenAsset).includes('linked_projects'), 'landscape reader: no project section on the asset');

  const shown = await h.entities.getEntityContext(ctx(runner, s, 'full'), { entity_type: 'applications', entity_id: 'APP-1' });
  assert.ok(relations(shown).includes('linked_projects'), 'full reader: the project section on the application');
  const shownAsset = await h.entities.getEntityContext(ctx(runner, s, 'full'), { entity_type: 'assets', entity_id: s.asset });
  assert.ok(relations(shownAsset).includes('linked_projects'), 'full reader: the project section on the asset');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testApplicationDetail(harness, runner, s);
      await testAssetDetail(harness, runner, s);
      await testBudgetAndContractDetails(harness, runner, s);
      await testApplicationList(harness, runner, s);
      await testContexts(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-linked-read-rights.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
