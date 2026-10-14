import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { ensureDefaultAnalyticsAxis } from '../../analytics/analytics-axes.util';

// The contract between the AI query registries (`query/registries/*`) and the list services
// they call, for every entity family. Plaid chat and the MCP server read through them.
//
// - Every sort field a registry advertises is applied: the list's statements differ between
//   asc and desc, and from a sort the service does not know (which falls back to its own
//   default column, `SERVICE_FALLBACK_SORT`, or fails). Every filter field is applied: the
//   statements differ from the unfiltered ones. Checked on the SQL each call sends, so the
//   check does not depend on the data's values (ties, nulls).
// - On seeded data, two rows per family created a year apart: created_at desc lists the newer
//   first, asc the older first, and each item carries its created_at.
// - A sort field the registry does not advertise is never dropped silently: the result names it
//   in `sort_ignored`, with the order it applied and the fields it could have used.
// - Page sizes: the default, the general maximum and the family maximum (`aiQueryLimit`); a
//   reduced page size is named in `limit_capped`.
// - The currency of the amounts: budget lines in the tenant's reporting currency
//   (`amounts_currency`), in lists, sums and details; contracts in each contract's own; a line's
//   years without a rate named in `amounts_fx_missing_years`.
// - A field flagged `sortable` is a sort field, and the other way around.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-query-contract-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

/**
 * The column a list service sorts on when it does not know the requested one. A sort field on
 * that column cannot be told apart from the fallback by its statements; it is checked on data.
 */
const SERVICE_FALLBACK_SORT: Record<string, string> = {
  analytics_categories: 'sort_order',
  applications: 'created_at',
  assets: 'created_at',
  business_processes: 'name',
  capex_items: 'created_at',
  companies: 'name',
  connections: 'created_at',
  contacts: 'created_at',
  contracts: 'next_due_date',
  departments: 'name',
  documents: 'updated_at',
  incidents: 'detected_at',
  interfaces: 'interface_reference',
  locations: 'created_at',
  projects: 'created_at',
  requests: 'created_at',
  spend_items: 'created_at',
  tasks: 'created_at',
  users: 'last_name',
};

const OLDER = '2030-01-15T10:00:00.000Z';
const NEWER = '2031-01-15T10:00:00.000Z';

type Harness = { app: any; dataSource: DataSource; executor: any; aggregates: any; registries: any };
type Seed = { tenantId: string; userId: string; rows: Record<string, { older: string; newer: string }> };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-query-registry-contract.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const registries = require('../query/registries');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return { app, dataSource: app.get(DataSource), executor: app.get(AiQueryExecutor), aggregates: app.get(AiAggregateExecutor), registries };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

/** Two rows per family, `older` and `newer` by created_at (both later than any other row of the tenant). */
async function seedTenant(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-contract-${tag}`, `AI contract ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const roleId = await insertId(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Administrator', 'Administrator', false, false, now(), now())`, [tenantId]);
  const axisId = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);

  const rows: Seed['rows'] = {};
  const pair = async (family: string, insert: (n: number, createdAt: string) => Promise<string>) => {
    rows[family] = { older: await insert(1, OLDER), newer: await insert(2, NEWER) };
  };

  await pair('users', (n, at) => insertId(runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, created_at, updated_at)
     VALUES ($1, $2, 'Contract', $3, $4, false, 'enabled', $5, $5)`,
    [tenantId, `User${n}`, `contract-${n}-${tag}@example.test`, roleId, at]));
  const userId = rows.users.newer;
  await pair('companies', (n, at) => insertId(runner,
    `INSERT INTO companies (tenant_id, name, country_iso, city, created_at, updated_at) VALUES ($1, $2, 'FR', 'Paris', $3, $3)`,
    [tenantId, `Company ${n}`, at]));
  const companyId = rows.companies.older;
  await pair('departments', (n, at) => insertId(runner,
    `INSERT INTO departments (tenant_id, company_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
    [tenantId, companyId, `Department ${n}`, at]));
  await pair('suppliers', (n, at) => insertId(runner,
    `INSERT INTO suppliers (tenant_id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
    [tenantId, `Supplier ${n}`, at]));
  const supplierId = rows.suppliers.older;
  await pair('contacts', (n, at) => insertId(runner,
    `INSERT INTO contacts (tenant_id, email, first_name, last_name, supplier_id, created_at, updated_at) VALUES ($1, $2, 'Contact', $3, $4, $5, $5)`,
    [tenantId, `contact-${n}-${tag}@example.test`, `Number ${n}`, supplierId, at]));
  await pair('chart_of_accounts', (n, at) => insertId(runner,
    `INSERT INTO chart_of_accounts (tenant_id, code, name, scope, created_at, updated_at) VALUES ($1, $2, $3, 'GLOBAL', $4, $4)`,
    [tenantId, `COA${n}`, `Chart ${n}`, at]));
  await pair('accounts', (n, at) => insertId(runner,
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
    [tenantId, rows.chart_of_accounts.older, 6000 + n, `Account ${n}`, at]));
  await pair('analytics_categories', (n, at) => insertId(runner,
    `INSERT INTO analytics_categories (tenant_id, axis_id, name, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
    [tenantId, axisId, `Category ${n}`, n, at]));
  await pair('business_processes', (n, at) => insertId(runner,
    `INSERT INTO business_processes (tenant_id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
    [tenantId, `Process ${n}`, at]));
  await pair('locations', (n, at) => insertId(runner,
    `INSERT INTO locations (tenant_id, name, hosting_type, location_reference, created_at, updated_at) VALUES ($1, $2, 'on_premise', $3, $4, $4)`,
    [tenantId, `Location ${n}`, `LOC-${n}`, at]));
  await pair('applications', (n, at) => insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
    [tenantId, `Application ${n}`, `APP-${n}`, at]));
  await pair('assets', (n, at) => insertId(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment, created_at, updated_at) VALUES ($1, $2, 'server', 'prod', $3, $3)`,
    [tenantId, `Asset ${n}`, at]));
  await pair('interfaces', (n, at) => insertId(runner,
    `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id, data_category,
                             integration_route_type, interface_reference, created_at, updated_at)
     VALUES ($1, $2, 'Contract', $3, $4, 'master_data', 'direct', $5, $6, $6)`,
    [tenantId, `Interface ${n}`, rows.applications.older, rows.applications.newer, `INT-${n}`, at]));
  await pair('connections', (n, at) => insertId(runner,
    `INSERT INTO connections (tenant_id, name, topology, connection_reference, created_at, updated_at) VALUES ($1, $2, 'server_to_server', $3, $4, $4)`,
    [tenantId, `Connection ${n}`, `CONN-${n}`, at]));
  await pair('contracts', (n, at) => insertId(runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, created_at, updated_at) VALUES ($1, $2, $3, $4, '2026-01-01', $5, $5)`,
    [tenantId, `Contract ${n}`, companyId, supplierId, at]));
  for (const nature of ['opex', 'capex'] as const) {
    await pair(nature === 'opex' ? 'spend_items' : 'capex_items', (n, at) => insertId(runner,
      `INSERT INTO spend_items (tenant_id, nature, product_name, currency, effective_start, item_number, paying_company_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'EUR', '2026-01-01', $4, $5, $6, $6)`,
      [tenantId, nature, `${nature} line ${n}`, (nature === 'opex' ? 0 : 10) + n, companyId, at]));
  }
  await pair('projects', (n, at) => insertId(runner,
    `INSERT INTO portfolio_projects (tenant_id, name, item_number, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
    [tenantId, `Project ${n}`, n, at]));
  await pair('requests', (n, at) => insertId(runner,
    `INSERT INTO portfolio_requests (tenant_id, name, item_number, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
    [tenantId, `Request ${n}`, n, at]));
  await pair('tasks', (n, at) => insertId(runner,
    `INSERT INTO tasks (tenant_id, title, item_number, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
    [tenantId, `Task ${n}`, n, at]));
  const libraryId = await insertId(runner,
    `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Contract library', $2)`, [tenantId, `contract-${tag}`]);
  await pair('documents', (n, at) => insertId(runner,
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'published', $5, $5)`,
    [tenantId, libraryId, `Document ${n}`, n, at]));
  await pair('incidents', (n, at) => insertId(runner,
    `INSERT INTO incidents (tenant_id, title, item_number, severity, created_at, updated_at) VALUES ($1, $2, $3, 'minor', $4, $4)`,
    [tenantId, `Incident ${n}`, n, at]));

  return { tenantId, userId, rows };
}

function context(runner: QueryRunner, seed: Seed) {
  return {
    tenantId: seed.tenantId,
    userId: seed.userId,
    isPlatformHost: false,
    surface: 'mcp' as const,
    authMethod: 'api_key' as const,
    manager: runner.manager,
  };
}

type Run = { error: string | null; ids: string[]; sql: string; result: any };

/** One query in a savepoint, with the statements it sent (numbers masked: parameter counters, limits). */
async function runQuery(runner: QueryRunner, executor: any, ctx: any, input: Record<string, unknown>): Promise<Run> {
  await runner.query('SAVEPOINT contract_query');
  const statements: string[] = [];
  const original = runner.query.bind(runner);
  (runner as any).query = (sql: string, params?: unknown[], ...rest: unknown[]) => {
    statements.push(`${sql}\n${JSON.stringify(params ?? [])}`.replace(/\d+/g, 'N'));
    return original(sql, params as any[], ...(rest as []));
  };
  try {
    const result = await executor.execute(ctx, input);
    (runner as any).query = original;
    await runner.query('RELEASE SAVEPOINT contract_query');
    return { error: null, ids: result.items.map((item: any) => item.id), sql: statements.join('\n'), result };
  } catch (error: any) {
    (runner as any).query = original;
    await runner.query('ROLLBACK TO SAVEPOINT contract_query');
    return { error: String(error?.message ?? error), ids: [], sql: '', result: null };
  }
}

function probeValue(field: any): unknown {
  if (field.type === 'set') return [field.values?.find((value: unknown) => value !== null) ?? '__contract_probe__'];
  if (field.type === 'text') return '__contract_probe__';
  if (field.type === 'number') return { op: 'gt', value: 123456789 };
  return { op: 'after', value: '2999-01-01' };
}

async function testStaticConsistency(harness: Harness) {
  for (const [entityType, registry] of Object.entries<any>(harness.registries.aiEntityRegistries)) {
    for (const [name, field] of Object.entries<any>(registry.fields)) {
      const listed = Object.prototype.hasOwnProperty.call(registry.sortFields, name);
      assert.equal(field.sortable === true, listed, `${entityType}.${name}: flagged sortable exactly when it is a sort field`);
      if (listed) assert.equal(registry.sortFields[name], field.grid, `${entityType}.${name}: sorts on the column it filters`);
    }
    for (const name of ['created_at', 'updated_at']) {
      assert.ok(registry.sortFields[name], `${entityType}: sorts on ${name}`);
    }
    assert.ok(registry.sortFields[registry.defaultSort.field] ?? registry.defaultSort.field, `${entityType}: default sort`);
  }
}

async function testEveryAdvertisedSortAndFilterApplies(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const failures: string[] = [];
  for (const entityType of Object.keys(harness.registries.aiEntityRegistries)) {
    const registry = await harness.registries.resolveAiEntityRegistry(ctx, entityType);
    // An unknown column, through the registry so the executor passes it on: the service's own fallback.
    registry.sortFields.__contract_probe__ = '__no_such_column__';
    let unknownAsc: Run;
    let unknownDesc: Run;
    try {
      unknownAsc = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, sort: { field: '__contract_probe__', direction: 'asc' } });
      unknownDesc = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, sort: { field: '__contract_probe__', direction: 'desc' } });
    } finally {
      delete registry.sortFields.__contract_probe__;
    }
    const unfiltered = await runQuery(runner, harness.executor, ctx, { entity_type: entityType });
    assert.equal(unfiltered.error, null, `${entityType}: the default query runs (${unfiltered.error})`);
    assert.ok(unfiltered.ids.length >= 2, `${entityType}: the seeded rows are listed (${unfiltered.ids.length})`);

    for (const [field, grid] of Object.entries<string>(registry.sortFields)) {
      const asc = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, sort: { field, direction: 'asc' } });
      const desc = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, sort: { field, direction: 'desc' } });
      const label = `${entityType} sort ${field} (${grid})`;
      if (asc.error || desc.error) failures.push(`${label}: fails: ${asc.error ?? desc.error}`);
      else if (asc.result.sort_ignored.length || desc.result.sort_ignored.length) failures.push(`${label}: reported as ignored`);
      else if (asc.sql === desc.sql) failures.push(`${label}: asc and desc send the same statements`);
      else if (!unknownAsc.error && asc.sql === unknownAsc.sql && desc.sql === unknownDesc.sql && SERVICE_FALLBACK_SORT[entityType] !== grid) {
        failures.push(`${label}: sorts like an unknown column (the service falls back to ${SERVICE_FALLBACK_SORT[entityType] ?? 'its default'})`);
      }
    }

    for (const [field, definition] of Object.entries<any>(registry.fields)) {
      const filtered = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, filters: { [field]: probeValue(definition) } });
      const label = `${entityType} filter ${field} (${definition.grid}, ${definition.type})`;
      if (filtered.error) failures.push(`${label}: fails: ${filtered.error}`);
      else if (filtered.result.filters_ignored.length) failures.push(`${label}: reported as ignored`);
      else if (filtered.sql === unfiltered.sql) failures.push(`${label}: sends the same statements as no filter`);
    }
  }
  assert.deepEqual(failures, [], `every advertised sort and filter applies:\n${failures.join('\n')}`);
}

async function testCreatedAtOrderOnSeededRows(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  for (const [entityType, { older, newer }] of Object.entries(seed.rows)) {
    const desc = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, sort: { field: 'created_at', direction: 'desc' } });
    assert.equal(desc.error, null, `${entityType}: created_at desc runs (${desc.error})`);
    assert.deepEqual(desc.result.sort, { field: 'created_at', direction: 'desc' }, `${entityType}: the result names its order`);
    assert.deepEqual(desc.ids.slice(0, 2), [newer, older], `${entityType}: created_at desc lists the latest created first`);
    assert.equal(desc.result.items[0].created_at, NEWER, `${entityType}: an item carries its created_at`);
    const asc = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, sort: { field: 'created_at', direction: 'asc' } });
    assert.ok(asc.ids.indexOf(older) < asc.ids.indexOf(newer) && asc.ids.indexOf(older) >= 0, `${entityType}: created_at asc lists the older first`);
  }
}

async function testUnknownSortIsReported(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const registry = harness.registries.aiEntityRegistries.applications;
  const { result } = await runQuery(runner, harness.executor, ctx, { entity_type: 'applications', sort: { field: 'creation_date', direction: 'desc' } });
  assert.deepEqual(result.sort_ignored, ['creation_date'], 'the unknown field is named');
  assert.deepEqual(result.sort, registry.defaultSort, 'the result names the order it applied');
  assert.ok(result.sortable_fields.includes('created_at') && result.sortable_fields.includes('sequential_id'), 'the fields it could have used');
  assert.equal(result.complete, false, 'a result in another order than asked is not complete');
  assert.equal(result.items.length, 2, 'the items still come, in the default order');

  const known = await runQuery(runner, harness.executor, ctx, { entity_type: 'applications', sort: { field: 'sequential_id', direction: 'desc' } });
  assert.deepEqual(known.result.sort_ignored, [], 'a known field ignores nothing');
  assert.deepEqual(known.ids, [seed.rows.applications.newer, seed.rows.applications.older], 'APP-2 before APP-1');
}

async function testPageSizes(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const { AI_QUERY_DEFAULT_LIMIT, AI_QUERY_MAX_LIMIT, AI_QUERY_FAMILY_MAX_LIMIT } = require('../query/ai-query.executor');
  const limitOf = async (entityType: string, limit?: number) =>
    (await runQuery(runner, harness.executor, ctx, { entity_type: entityType, ...(limit ? { limit } : {}) })).result.limit;
  assert.equal(await limitOf('suppliers'), AI_QUERY_DEFAULT_LIMIT, 'the default page size');
  assert.equal(await limitOf('suppliers', 7), 7, 'a smaller page size is kept');
  assert.equal(await limitOf('suppliers', 500), AI_QUERY_MAX_LIMIT, 'a larger one is reduced to the maximum');
  const capped = await runQuery(runner, harness.executor, ctx, { entity_type: 'spend_items', limit: 16 });
  assert.deepEqual(capped.result.limit_capped, { requested: 16, applied: 15 }, 'a reduced page size is named');
  const kept = await runQuery(runner, harness.executor, ctx, { entity_type: 'spend_items', limit: 15 });
  assert.equal(kept.result.limit_capped, undefined, 'a page size within the maximum is not');
  for (const [entityType, max] of Object.entries<number>(AI_QUERY_FAMILY_MAX_LIMIT)) {
    assert.equal(await limitOf(entityType, 500), max, `${entityType}: its own maximum`);
    assert.equal(await limitOf(entityType), Math.min(AI_QUERY_DEFAULT_LIMIT, max), `${entityType}: its default`);
  }
  const page = await runQuery(runner, harness.executor, ctx, { entity_type: 'suppliers', limit: 1, page: 2, sort: { field: 'created_at', direction: 'desc' } });
  assert.deepEqual(page.ids, [seed.rows.suppliers.older], 'page 2 of 1 is the second row');
  assert.equal(page.result.truncated, false, 'the last page is not truncated');
}

async function testAmountsCurrency(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  // Not the lines' currency (EUR): the amounts follow the tenant's reporting currency.
  await runner.query(`UPDATE tenants SET metadata = metadata || '{"reporting_currency":"CHF"}'::jsonb WHERE id = $1`, [seed.tenantId]);
  for (const entityType of ['spend_items', 'capex_items']) {
    const { result, error } = await runQuery(runner, harness.executor, ctx, { entity_type: entityType });
    assert.equal(error, null, `${entityType}: runs (${error})`);
    assert.equal(result.amounts_currency, 'CHF', `${entityType}: the amounts are in the reporting currency`);
    assert.match(result.amounts_currency_note, /CHF is the reporting currency/, `${entityType}: the note says so`);
    assert.equal(result.items[0].metadata.currency, 'EUR', `${entityType}: the item keeps its own currency`);
    assert.equal(result.items[0].metadata.amounts_fx_missing_years, null, `${entityType}: no year without a rate`);

    const sum = await harness.aggregates.execute(ctx, { entity_type: entityType, group_by: 'currency', metric: 'y_budget', function: 'sum' });
    assert.equal(sum.amounts_currency, 'CHF', `${entityType}: a sum of amounts names their currency`);
    const count = await harness.aggregates.execute(ctx, { entity_type: entityType, group_by: 'currency' });
    assert.equal(count.amounts_currency, undefined, `${entityType}: a count has no currency`);
    const fte = await harness.aggregates.execute(ctx, { entity_type: entityType, group_by: 'currency', metric: 'y_budget_fte', function: 'sum' });
    assert.equal(fte.amounts_currency, undefined, `${entityType}: nor an FTE`);

    const detail = await harness.executor.executeDetail(ctx, { entity_type: entityType, entity_id: seed.rows[entityType].newer });
    assert.equal(detail.amounts_currency, 'CHF', `${entityType}: the detail names the currency of its amounts`);
    assert.match(detail.amounts_currency_note, /versions\.\*\.totals and financial_versions are in the line's own currency/, `${entityType}: and which ones are the line's`);
  }

  const contracts = await runQuery(runner, harness.executor, ctx, { entity_type: 'contracts' });
  assert.equal(contracts.result.amounts_currency, null, 'contracts: no single currency');
  assert.match(contracts.result.amounts_currency_note, /each contract's own currency/, 'contracts: each its own');
  const contractSum = await harness.aggregates.execute(ctx, { entity_type: 'contracts', group_by: 'currency', metric: 'yearly_amount', function: 'sum' });
  assert.match(contractSum.amounts_currency_note, /do not add up/, 'contracts: a sum warns across currencies');
  const users = await runQuery(runner, harness.executor, ctx, { entity_type: 'users' });
  assert.equal('amounts_currency' in users.result, false, 'a family without amounts says nothing');

  const { budgetFxMissingYears } = require('../query/ai-query.executor');
  const reporting = (currency: string, fx_source: string) => ({ reporting: { currency, reporting_currency: 'EUR', fx_source } });
  const row = { versions: { y: reporting('USD', 'missing'), yPlus1: reporting('USD', 'live'), yMinus1: reporting('EUR', 'missing') } };
  assert.deepEqual(budgetFxMissingYears(row, 2026), [2026], 'a year without a rate for another currency is named, not the reporting currency');
}

async function run() {
  const harness = await createHarness();
  try {
    await testStaticConsistency(harness);
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const seed = await seedTenant(runner);
      await testEveryAdvertisedSortAndFilterApplies(harness, runner, seed);
      await testCreatedAtOrderOnSeededRows(harness, runner, seed);
      await testUnknownSortIsReported(harness, runner, seed);
      await testPageSizes(harness, runner, seed);
      await testAmountsCurrency(harness, runner, seed);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-query-registry-contract.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
