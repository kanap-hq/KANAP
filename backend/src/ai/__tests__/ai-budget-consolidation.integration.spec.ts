import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { consolidationRequest, readConsolidation, type ColumnFilters } from '../../spend/reports/shared/reportAggregates';
import { adaptFilters } from '../query/ai-filter.adapter';
import { describeAiEntityFilters } from '../query/ai-filter-description.util';
import { getAiEntityRegistry, resolveAiEntityRegistry } from '../query/registries';

// The budget lines of Plaid and the MCP server read through the list engine with the person's
// access, as the screens pass it (lot L8 A of the Plaid pass), against the database:
// - every engine call of the aggregates, the lists and the filter values receives the access built
//   from the person's rights (`AiPolicyService.effectiveAccess`): readers of accounts read the
//   consolidation fields, the others do not;
// - nothing else changes: an aggregate, a list (items and totals) and filter values on today's
//   fields give the same results with the access as without it;
// - `consolidation_account`, the consolidation account of the line's account: aggregate_entities
//   grouped by it equals the Consolidation accounts report (its own request and reader,
//   `consolidationRequest` and `readConsolidation`, run on the same lines), without and with a
//   filter, two accounts of one consolidation number in one group, the lines without one in the
//   null group, the amounts of two currencies converted as the report converts them;
// - the field filters, sorts, lists its values and shows on each listed line;
// - without the right on accounts the field is absent from the registry, the description, the
//   groups, the filters, the filter values and the items, and the description and the refusals say
//   why; a reader of budget and accounts reads it;
// - a person limited to one company adds up the consolidation accounts of that company's lines,
//   as the report filtered on it, said within their access.
// @database-spec: boots the application context, so run-ci-tests.js runs this file in a database lane.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-budget-consolidation-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const Y = new Date().getFullYear();
/** USD per EUR for the year: the USD lines are converted into the reporting currency (EUR). */
const USD_RATE = 1.25;

type Harness = { app: any; dataSource: DataSource; aggregates: any; queries: any; policy: any; budgetLines: any };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-budget-consolidation.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { AiPolicyService } = require('../ai-policy.service');
  const { BudgetLinesService } = require('../../spend/budget-lines.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return {
    app,
    dataSource: app.get(DataSource),
    aggregates: app.get(AiAggregateExecutor),
    queries: app.get(AiQueryExecutor),
    policy: app.get(AiPolicyService),
    budgetLines: app.get(BudgetLinesService),
  };
}

type Line = {
  label: string;
  nature: 'opex' | 'capex';
  account: string | null;
  company: 'a' | 'b';
  supplier: 's1' | 's2' | null;
  currency: 'EUR' | 'USD';
  planned: number;
};

/**
 * The accounts: two of one consolidation number under two names (one consolidation account), one
 * of another number, one without a consolidation account, one with a consolidation name only.
 */
const ACCOUNTS: Array<{ key: string; number: number; name: string; consolidation: [number | null, string | null] | null }> = [
  { key: 'licences', number: 6011, name: 'Licences', consolidation: [601, 'Software'] },
  { key: 'subscriptions', number: 6012, name: 'Subscriptions', consolidation: [601, 'Software and cloud'] },
  { key: 'consulting', number: 6100, name: 'Consulting', consolidation: [610, 'Services'] },
  { key: 'misc', number: 6200, name: 'Miscellaneous', consolidation: null },
  { key: 'travel', number: 6300, name: 'Travel costs', consolidation: [null, 'Travel'] },
];

/** Both natures, two currencies, every line active this year; no two groups tie. */
const LINES: Line[] = [
  { label: 'licences', nature: 'opex', account: 'licences', company: 'a', supplier: 's1', currency: 'EUR', planned: 1000 },
  { label: 'cloud', nature: 'opex', account: 'subscriptions', company: 'b', supplier: 's2', currency: 'USD', planned: 500 },
  { label: 'integration', nature: 'capex', account: 'consulting', company: 'a', supplier: 's1', currency: 'EUR', planned: 2000 },
  { label: 'misc', nature: 'opex', account: 'misc', company: 'b', supplier: null, currency: 'EUR', planned: 300 },
  { label: 'no account', nature: 'opex', account: null, company: 'a', supplier: null, currency: 'EUR', planned: 210 },
  { label: 'travel', nature: 'capex', account: 'travel', company: 'b', supplier: 's2', currency: 'EUR', planned: 700 },
  { label: 'audit', nature: 'opex', account: 'consulting', company: 'a', supplier: null, currency: 'USD', planned: 450 },
];

type Seed = {
  tenantId: string;
  users: { admin: string; budgetOnly: string; budgetAndAccounts: string; limited: string };
  companies: Record<'a' | 'b', { id: string; name: string }>;
  lines: Record<string, string>;
};

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seedRole(runner: QueryRunner, tenantId: string, name: string, rights: string[]): Promise<string> {
  const roleId = await insertId(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, $2, 'consolidation spec', false, false)`,
    [tenantId, name]);
  for (const resource of rights) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'reader')`, [tenantId, roleId, resource]);
  }
  return roleId;
}

async function seedUser(runner: QueryRunner, tenantId: string, roleId: string, mode: 'all' | 'limited' = 'all'): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO users (id, tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, data_access_mode)
     VALUES ($1, $2, 'Consolidation', 'Spec', $3, $4, false, 'enabled', $5)`,
    [id, tenantId, `consolidation-${id.slice(0, 8)}@example.test`, roleId, mode],
  );
  return id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-consolidation-${tag}`, `AI consolidation ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  await runner.query(
    `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates) VALUES ($1, $2, 'EUR', $3::jsonb)`,
    [tenantId, Y, JSON.stringify({ USD: USD_RATE })],
  );
  const budgetAndAccountsRole = await seedRole(runner, tenantId, 'Budget and accounts', ['budget', 'accounts']);
  const company = async (name: string) => ({
    id: await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Lyon', 'enabled')`, [tenantId, `${name} ${tag}`]),
    name: `${name} ${tag}`,
  });
  const companies = { a: await company('Company A'), b: await company('Company B') };
  const users = {
    admin: await seedUser(runner, tenantId, await seedRole(runner, tenantId, 'Administrator', [])),
    budgetOnly: await seedUser(runner, tenantId, await seedRole(runner, tenantId, 'Budget only', ['budget'])),
    budgetAndAccounts: await seedUser(runner, tenantId, budgetAndAccountsRole),
    // Limited to company A, with the right on accounts.
    limited: await seedUser(runner, tenantId, budgetAndAccountsRole, 'limited'),
  };
  await runner.query(
    `INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access) VALUES ($1, $2, 'company', $3, 'read')`,
    [tenantId, users.limited, companies.a.id],
  );
  const suppliers = {
    s1: await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2)`, [tenantId, `Supplier one ${tag}`]),
    s2: await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2)`, [tenantId, `Supplier two ${tag}`]),
  };
  const coaId = await insertId(runner,
    `INSERT INTO chart_of_accounts (tenant_id, code, name, scope) VALUES ($1, $2, 'Chart', 'GLOBAL')`, [tenantId, `COA-${tag}`]);
  const accounts: Record<string, string> = {};
  for (const account of ACCOUNTS) {
    accounts[account.key] = await insertId(runner,
      `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, consolidation_account_number, consolidation_account_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, coaId, account.number, account.name, account.consolidation?.[0] ?? null, account.consolidation?.[1] ?? null]);
  }
  const lines: Record<string, string> = {};
  for (const [i, line] of LINES.entries()) {
    const itemId = await insertId(runner,
      `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, supplier_id, paying_company_id, account_id)
       VALUES ($1, $2, $3, $4, $5, '2020-01-01', 'enabled', $6, $7, $8)`,
      [tenantId, line.nature, i + 1, `Line ${line.label}`, line.currency, line.supplier ? suppliers[line.supplier] : null,
        companies[line.company].id, line.account ? accounts[line.account] : null]);
    lines[line.label] = itemId;
    const versionId = await insertId(runner,
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year, allocation_method)
       VALUES ($1, $2, 'Y' || $4::int, $3::date, $4::int, 'default')`,
      [tenantId, itemId, `${Y}-01-01`, Y]);
    await runner.query(
      `INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, make_date($3, 1, 1), $4::numeric)`,
      [tenantId, versionId, Y, line.planned],
    );
  }
  return { tenantId, users, companies, lines };
}

function context(runner: QueryRunner, seed: Seed, userId: string) {
  return { tenantId: seed.tenantId, userId, isPlatformHost: false, surface: 'mcp' as const, authMethod: 'api_key' as const, manager: runner.manager };
}

const ENGINE_METHODS = ['summary', 'summaryTotals', 'summaryAggregate', 'summaryFilterValues'];

/**
 * Records the access each engine call of the budget lines service receives; with `strip`, calls
 * the engine without it, as before the lot (the consolidation fields then read null).
 */
function spyEngine(service: any) {
  const calls: Array<{ method: string; access: unknown }> = [];
  const state = { strip: false };
  for (const method of ENGINE_METHODS) {
    const original = service[method];
    service[method] = function (...args: any[]) {
      const opts = args[args.length - 1] ?? {};
      calls.push({ method, access: opts.access });
      if (state.strip) {
        const { access: _access, ...rest } = opts;
        args[args.length - 1] = rest;
      }
      return original.apply(this, args);
    };
  }
  return {
    calls,
    state,
    restore: () => { for (const method of ENGINE_METHODS) delete service[method]; },
  };
}

/** A query result without the consolidation account of its items: today's fields only. */
function todaysFields(result: any) {
  return {
    ...result,
    items: result.items.map((item: any) => {
      const { consolidation_account: _consolidation, ...metadata } = item.metadata ?? {};
      return { ...item, metadata };
    }),
  };
}

/** The reads of today's fields: an aggregate, a sum, a list with its totals, filter values. */
async function todaysReads(harness: Harness, ctx: any) {
  return {
    count: await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'account' }),
    sum: await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'supplier', metric: 'y_budget', function: 'sum' }),
    ratio: await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'paying_company', metric: 'y_budget_cost_per_fte' }),
    list: todaysFields(await harness.queries.execute(ctx, { entity_type: 'budget_lines', limit: 3, sort: { field: 'created_at', direction: 'desc' } })),
    filtered: todaysFields(await harness.queries.execute(ctx, { entity_type: 'budget_lines', filters: { nature: ['capex'] } })),
    values: await harness.queries.executeFilterValues(ctx, { entity_type: 'budget_lines', fields: ['supplier', 'account', 'paying_company'] }),
  };
}

async function testEngineAccess(harness: Harness, runner: QueryRunner, seed: Seed) {
  const spy = spyEngine(harness.budgetLines);
  try {
    for (const [who, userId, accounts] of [
      ['an administrator', seed.users.admin, true],
      ['a reader of budget and accounts', seed.users.budgetAndAccounts, true],
      ['a reader of budget only', seed.users.budgetOnly, false],
    ] as Array<[string, string, boolean]>) {
      spy.calls.length = 0;
      spy.state.strip = false;
      const ctx = context(runner, seed, userId);
      const withAccess = await todaysReads(harness, ctx);
      const methods = new Set(spy.calls.map((call) => call.method));
      assert.deepEqual([...methods].sort(), [...ENGINE_METHODS].sort(), `${who}: every engine method is called`);
      for (const call of spy.calls) {
        assert.deepEqual(call.access, { accounts }, `${who}: ${call.method} receives the person's access`);
      }
      // Before the lot, the engine ran without the access: today's fields read the same.
      spy.state.strip = true;
      const without = await todaysReads(harness, ctx);
      assert.deepEqual(withAccess, without, `${who}: today's fields read the same with the access`);
      assert.equal(withAccess.list.total, LINES.length, `${who}: every line is listed`);
      assert.ok(withAccess.sum.groups.length >= 3, `${who}: the sum has groups`);
    }
  } finally {
    spy.restore();
  }
  console.log('ok - every engine call receives the access; today\'s fields read the same');
}

/** What the report and the tools call the lines without a consolidation account, here. */
const NONE = 'without a consolidation account';

/**
 * The Consolidation accounts report for Budget Y, read by its own functions on its own request
 * (`POST /budget-lines/summary/aggregate`, both natures, a reader of accounts): `[label, amount]`
 * per row in its order, and the total.
 */
async function reportRows(harness: Harness, runner: QueryRunner, filters: ColumnFilters = {}) {
  const request = consolidationRequest({ years: [Y], metric: 'budget', excludedAccountIds: [], filters });
  const answer = await harness.budgetLines.summaryAggregateRequest(request, { manager: runner.manager, access: { accounts: true } });
  const read = readConsolidation([Y], answer, NONE);
  return { rows: read.groups.map((group) => [group.label, group.values[Y]]), total: read.totals[Y] };
}

/** The AI aggregate by consolidation account, as the report's rows. */
function aiRows(result: any) {
  return { rows: result.groups.map((group: any) => [group.key ?? NONE, group.value]), total: result.overall.value };
}

const byConsolidation = (filters?: Record<string, unknown>) => ({
  entity_type: 'budget_lines', group_by: 'consolidation_account', metric: 'y_budget', function: 'sum', ...(filters ? { filters } : {}),
});

async function testAsTheReport(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed, seed.users.admin);
  const result = await harness.aggregates.execute(ctx, byConsolidation());
  const report = await reportRows(harness, runner);
  assert.equal(report.rows.length, 4, 'the report has four rows');
  assert.deepEqual(aiRows(result), report, 'groups, order and overall equal the report');
  assert.deepEqual(result.groups.map((group: any) => group.key), ['[610] Services', '[601] Software', 'Travel', null],
    'one group per consolidation account (two accounts of 601 under one name), the lines without one under null');
  assert.notEqual(result.groups[1].value, 1500, 'the USD line is converted, not added as is');
  assert.equal(result.amounts_currency, 'EUR', 'the sum names its currency');
  assert.deepEqual(result.amounts_fx_missing, [], 'no amount left out');
  assert.match(result.amounts_currency_note, /EUR is the reporting currency/, 'the currency note stays');

  const filters = { paying_company: [seed.companies.a.name] };
  const filtered = await harness.aggregates.execute(ctx, byConsolidation(filters));
  const filteredReport = await reportRows(harness, runner, adaptFilters(getAiEntityRegistry('budget_lines'), filters).filters);
  assert.deepEqual(aiRows(filtered), filteredReport, 'with a filter, as the report on the same filter');
  assert.equal(filtered.groups.length, 3, 'company A: three rows');

  // The same groups for a reader of budget and accounts.
  const reader = await harness.aggregates.execute(context(runner, seed, seed.users.budgetAndAccounts), byConsolidation());
  assert.deepEqual(aiRows(reader), report, 'a reader of budget and accounts reads the same figures');
  console.log('ok - grouped by consolidation account as the report');
}

async function testFilterSortValues(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed, seed.users.admin);
  const counted = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'nature', filters: { consolidation_account: ['[601] Software'] } });
  assert.equal(counted.total, 2, 'the two lines of the 601 accounts');
  const without = await harness.queries.execute(ctx, { entity_type: 'budget_lines', filters: { consolidation_account: [null] }, sort: { field: 'product_name', direction: 'asc' } });
  assert.deepEqual(without.items.map((item: any) => [item.label, item.metadata.consolidation_account]), [['Line misc', null], ['Line no account', null]],
    'the lines without a consolidation account, said null');
  const travel = await harness.queries.execute(ctx, { entity_type: 'budget_lines', filters: { consolidation_account: ['Travel'] } });
  assert.deepEqual(travel.items.map((item: any) => [item.label, item.metadata.consolidation_account]), [['Line travel', 'Travel']], 'a name-only consolidation account');
  const sorted = await harness.queries.execute(ctx, { entity_type: 'budget_lines', sort: { field: 'consolidation_account', direction: 'asc' }, limit: 30 });
  assert.deepEqual(sorted.sort_ignored, [], 'the field sorts');
  assert.deepEqual(sorted.items.map((item: any) => item.metadata.consolidation_account).slice(0, 3), ['[601] Software', '[601] Software', '[610] Services'],
    'each line carries its consolidation account, in order');
  const values = await harness.queries.executeFilterValues(ctx, { entity_type: 'budget_lines', fields: ['consolidation_account'] });
  assert.deepEqual([...values.values.consolidation_account].sort(), ['[601] Software', '[610] Services', 'Travel', null].sort(), 'its values');
  assert.equal(values.fields_withheld, undefined, 'nothing withheld');
  console.log('ok - filtered, sorted, listed with its values');
}

async function testWithoutAccountsRight(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed, seed.users.budgetOnly);
  const probe = (entityType: any) => harness.policy.canReadEntityType(ctx, entityType, runner.manager);
  const registry = await resolveAiEntityRegistry(ctx, 'budget_lines', probe);
  assert.equal(registry.fields.consolidation_account, undefined, 'not a field of the registry');
  assert.equal(registry.sortFields.consolidation_account, undefined, 'nor a sort');
  const description = describeAiEntityFilters('budget_lines', registry);
  assert.equal(description.fields.some((field) => field.field === 'consolidation_account'), false, 'not described as a field');
  assert.equal(description.fields_withheld?.[0]?.field, 'consolidation_account', 'named as withheld');
  assert.match(description.fields_withheld![0].reason, /right on accounts/, 'with the reason: the right on accounts');

  await assert.rejects(harness.aggregates.execute(ctx, byConsolidation()), (error: any) => {
    assert.equal(error?.status, 403, 'a refusal of a right');
    assert.match(error.message, /right on accounts/, 'in words');
    return true;
  }, 'never one "unassigned" group');
  const filtered = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'nature', filters: { consolidation_account: ['[601] Software'] } });
  assert.equal(filtered.status, 'invalid_filter', 'a filter on it is refused');
  assert.match(filtered.suggested_repairs[0].reason, /right on accounts/, 'with the reason');
  const listed = await harness.queries.execute(ctx, { entity_type: 'budget_lines' });
  assert.equal(listed.items.length, LINES.length, 'the lines are listed');
  assert.equal(listed.items.some((item: any) => 'consolidation_account' in item.metadata), false, 'without the field');
  const sorted = await harness.queries.execute(ctx, { entity_type: 'budget_lines', sort: { field: 'consolidation_account', direction: 'asc' } });
  assert.deepEqual(sorted.sort_ignored, ['consolidation_account'], 'a sort on it is ignored');
  assert.equal(sorted.fields_withheld?.[0]?.field, 'consolidation_account');
  assert.match(sorted.fields_withheld?.[0]?.reason ?? '', /right on accounts/, 'with the reason, not only the default order');
  const values = await harness.queries.executeFilterValues(ctx, { entity_type: 'budget_lines', fields: ['consolidation_account', 'supplier'] });
  assert.deepEqual(values.fields_ignored, ['consolidation_account'], 'no values');
  assert.match(values.fields_withheld?.[0]?.reason ?? '', /right on accounts/, 'and why');

  const readerRegistry = await resolveAiEntityRegistry(context(runner, seed, seed.users.budgetAndAccounts), 'budget_lines',
    (entityType: any) => harness.policy.canReadEntityType(context(runner, seed, seed.users.budgetAndAccounts), entityType, runner.manager));
  assert.ok(readerRegistry.fields.consolidation_account, 'a reader of accounts has the field');
  assert.equal(readerRegistry.withheldFields, undefined, 'and nothing withheld');
  console.log('ok - absent without the right on accounts, with the reason');
}

/** A person limited to company A adds up the consolidation accounts of company A's lines, as the report on it. */
async function testLimitedPerson(harness: Harness, runner: QueryRunner, seed: Seed) {
  if (!(await runner.query(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`))[0].present) {
    if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
    console.log('skip - kanap_data_limited not installed');
    return;
  }
  const expected = await reportRows(harness, runner, adaptFilters(getAiEntityRegistry('budget_lines'), { paying_company: [seed.companies.a.name] }).filters);
  assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [seed.users.limited]))[0].mode, 'limited');
  const result = await harness.aggregates.execute(context(runner, seed, seed.users.limited), byConsolidation());
  assert.deepEqual(aiRows(result), expected, 'the lines of company A only, as the report on company A');
  assert.equal(result.data_access, 'limited', 'said within their access');
  assert.equal(result.amounts_currency, 'EUR', 'in the reporting currency');
  console.log('ok - a limited person adds up their lines only');
}

async function inTransaction(harness: Harness, fn: (runner: QueryRunner, seed: Seed) => Promise<void>) {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner, await seed(runner));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function run() {
  const harness = await createHarness();
  try {
    await inTransaction(harness, async (runner, s) => {
      await testEngineAccess(harness, runner, s);
      await testAsTheReport(harness, runner, s);
      await testFilterSortValues(harness, runner, s);
      await testWithoutAccountsRight(harness, runner, s);
    });
    // `data_access_apply` limits the rest of its transaction: a transaction of its own.
    await inTransaction(harness, (runner, s) => testLimitedPerson(harness, runner, s));
  } finally {
    await harness.app.close();
  }
  console.log('ai-budget-consolidation.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
