import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Several metrics and a second group field on the budget lines of Plaid and the MCP server (lot
// L8 B of the Plaid pass), against the database:
// - `metrics`: 2 to 8 metrics with one function in one call; each group and `overall` carry
//   `values` by metric, equal to one simple aggregate per metric (company by column, by year),
//   the amounts converted as the simple aggregates convert them, the lines without a rate named,
//   `unknown` per FTE metric, no currency for FTE alone;
// - `then_by`: groups carry `key` and `then_key`, equal to the simple aggregate of each first key
//   filtered on it; the combination with no supplier is a group of its own (null);
// - `limit` (50 by default with then_by) and `others`: the groups past the limit summed in one
//   row, groups and others adding up to `overall`;
// - refused in words: a multi-valued field in a crossing, a ratio with metrics or then_by,
//   metric with metrics, a count with metrics, another family; the engine's limits as a 400;
// - a person limited to one company crosses the lines of that company only, said within their access.
// @database-spec: boots the application context, so run-ci-tests.js runs this file in a database lane.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-budget-multi-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const Y = new Date().getFullYear();
/** The USD rate of both years (a USD amount times the rate, in EUR); GBP has no rate (its line is left out of the amounts and named). */
const USD_RATE = 1.25;

type Harness = { app: any; dataSource: DataSource; aggregates: any; budgetLines: any };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-budget-multi.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { BudgetLinesService } = require('../../spend/budget-lines.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return { app, dataSource: app.get(DataSource), aggregates: app.get(AiAggregateExecutor), budgetLines: app.get(BudgetLinesService) };
}

type Line = {
  label: string;
  company: 'a' | 'b';
  supplier: 's1' | 's2' | null;
  currency: 'EUR' | 'USD' | 'GBP';
  /** Budget Y, revision Y, budget Y+1. */
  amounts: [number, number, number];
};

/** Two companies, two suppliers and lines without one, three currencies, two years; no two groups tie. */
const LINES: Line[] = [
  { label: 'a licences', company: 'a', supplier: 's1', currency: 'EUR', amounts: [1000, 1100, 1200] },
  { label: 'a internal', company: 'a', supplier: null, currency: 'EUR', amounts: [300, 350, 400] },
  { label: 'a cloud', company: 'a', supplier: 's1', currency: 'USD', amounts: [500, 520, 600] },
  { label: 'b network', company: 'b', supplier: 's2', currency: 'EUR', amounts: [2000, 1900, 2100] },
  { label: 'b london', company: 'b', supplier: null, currency: 'GBP', amounts: [10000, 10000, 10000] },
  { label: 'b support', company: 'b', supplier: 's1', currency: 'EUR', amounts: [700, 750, 800] },
  { label: 'b travel', company: 'b', supplier: null, currency: 'EUR', amounts: [150, 160, 170] },
];

type Seed = {
  tenantId: string;
  users: { admin: string; limited: string };
  companies: Record<'a' | 'b', string>;
  suppliers: Record<'s1' | 's2', string>;
};

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seedUser(runner: QueryRunner, tenantId: string, roleId: string, mode: 'all' | 'limited'): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO users (id, tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, data_access_mode)
     VALUES ($1, $2, 'Multi', 'Spec', $3, $4, false, 'enabled', $5)`,
    [id, tenantId, `multi-${id.slice(0, 8)}@example.test`, roleId, mode],
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
    [tenantId, `ai-multi-${tag}`, `AI multi ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  for (const year of [Y, Y + 1]) {
    await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates) VALUES ($1, $2, 'EUR', $3::jsonb)`,
      [tenantId, year, JSON.stringify({ USD: USD_RATE })],
    );
  }
  const roleId = await insertId(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Budget reader', 'multi spec', false, false)`, [tenantId]);
  await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', 'reader')`, [tenantId, roleId]);
  const adminRole = await insertId(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Administrator', 'multi spec', false, false)`, [tenantId]);
  const companies = {
    a: `Company A ${tag}`,
    b: `Company B ${tag}`,
  };
  const companyIds = {
    a: await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Lyon', 'enabled')`, [tenantId, companies.a]),
    b: await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Lyon', 'enabled')`, [tenantId, companies.b]),
  };
  const users = { admin: await seedUser(runner, tenantId, adminRole, 'all'), limited: await seedUser(runner, tenantId, roleId, 'limited') };
  await runner.query(
    `INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access) VALUES ($1, $2, 'company', $3, 'read')`,
    [tenantId, users.limited, companyIds.a],
  );
  const suppliers = { s1: `Supplier one ${tag}`, s2: `Supplier two ${tag}` };
  const supplierIds = {
    s1: await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2)`, [tenantId, suppliers.s1]),
    s2: await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2)`, [tenantId, suppliers.s2]),
  };
  for (const [i, line] of LINES.entries()) {
    const itemId = await insertId(runner,
      `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, supplier_id, paying_company_id)
       VALUES ($1, 'opex', $2, $3, $4, '2020-01-01', 'enabled', $5, $6)`,
      [tenantId, i + 1, `Line ${line.label}`, line.currency, line.supplier ? supplierIds[line.supplier] : null, companyIds[line.company]]);
    for (const [year, planned, committed] of [[Y, line.amounts[0], line.amounts[1]], [Y + 1, line.amounts[2], null]] as Array<[number, number, number | null]>) {
      const versionId = await insertId(runner,
        `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year, allocation_method)
         VALUES ($1, $2, 'Y' || $4::int, $3::date, $4::int, 'default')`,
        [tenantId, itemId, `${year}-01-01`, year]);
      await runner.query(
        `INSERT INTO spend_amounts (tenant_id, version_id, period, planned, committed) VALUES ($1, $2, make_date($3, 1, 1), $4::numeric, $5::numeric)`,
        [tenantId, versionId, year, planned, committed],
      );
    }
  }
  return { tenantId, users, companies, suppliers };
}

function context(runner: QueryRunner, seed: Seed, userId: string) {
  return { tenantId: seed.tenantId, userId, isPlatformHost: false, surface: 'mcp' as const, authMethod: 'api_key' as const, manager: runner.manager };
}

const COLUMNS = ['y_budget', 'y_review', 'y_plus1_budget'];
const cents = (value: number) => Math.round(value * 100);
const byKey = (groups: any[], value: (group: any) => unknown) => Object.fromEntries(groups.map((group) => [String(group.key), value(group)]));

async function testMetricsAsSimpleAggregates(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed, seed.users.admin);
  const multi = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'paying_company', metrics: COLUMNS, function: 'sum' });
  assert.deepEqual(multi.metrics, COLUMNS, 'the metrics are named');
  assert.equal(multi.metric, null, 'no single metric');
  assert.deepEqual(multi.groups.map((group: any) => group.key), [seed.companies.b, seed.companies.a], 'ordered by the first metric');
  for (const group of multi.groups) {
    assert.deepEqual(Object.keys(group.values), COLUMNS, 'one value per metric');
    assert.ok(group.count > 0, 'with its line count');
    assert.equal(group.value, undefined, 'no single value');
  }
  const fxMissing: Array<{ currency: string; year: number; lines: number }> = [];
  for (const key of COLUMNS) {
    const simple = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'paying_company', metric: key, function: 'sum' });
    assert.deepEqual(byKey(multi.groups, (group) => group.values[key]), byKey(simple.groups, (group) => group.value), `${key}: each group as the simple aggregate`);
    assert.equal(multi.overall.values[key], simple.overall.value, `${key}: overall as the simple aggregate`);
    fxMissing.push(...simple.amounts_fx_missing);
  }
  assert.equal(multi.overall.count, LINES.length, 'overall counts every line');
  // Company A, budget Y: 1000 + 300 + 500 USD converted, as the simple aggregate converts it.
  assert.equal(cents(byKey(multi.groups, (group) => group.values.y_budget)[seed.companies.a] as number), cents(1300 + 500 * USD_RATE), 'the USD line converted');
  assert.equal(multi.amounts_currency, 'EUR', 'the amounts name their currency');
  const pairs = (list: any[]) => [...new Map(list.map((pair) => [`${pair.currency}-${pair.year}`, pair])).values()]
    .sort((x, y) => x.year - y.year || x.currency.localeCompare(y.currency));
  assert.deepEqual(pairs(multi.amounts_fx_missing), pairs(fxMissing), 'the lines without a rate, every year of the metrics');
  assert.deepEqual(multi.amounts_fx_missing.map((pair: any) => [pair.currency, pair.year, pair.lines]), [['GBP', Y, 1], ['GBP', Y + 1, 1]], 'the GBP line, both years');
  assert.match(multi.amounts_currency_note, /GBP 2\d{3} \(1 line\)/, 'named in the note');

  // An FTE among the metrics: `unknown` per FTE metric, as the simple aggregate counts it.
  const withFte = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'paying_company', metrics: ['y_budget', 'y_budget_fte'], function: 'sum' });
  const simpleFte = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'paying_company', metric: 'y_budget_fte', function: 'sum' });
  assert.deepEqual(byKey(withFte.groups, (group) => [group.values.y_budget_fte, group.unknown]),
    byKey(simpleFte.groups, (group) => [group.value, { y_budget_fte: group.unknown }]), 'the FTE metric and its unknown lines');
  assert.deepEqual(withFte.overall.unknown, { y_budget_fte: LINES.length }, 'no line has an FTE');
  const fteOnly = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'paying_company', metrics: ['y_budget_fte', 'y_review_fte'], function: 'sum' });
  assert.equal(fteOnly.amounts_currency, undefined, 'FTE alone have no currency');

  // Suppliers by year, averages: the same function for every metric.
  const years = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'supplier', metrics: ['y_budget', 'y_plus1_budget'], function: 'avg' });
  const average = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'supplier', metric: 'y_plus1_budget', function: 'avg' });
  assert.deepEqual(byKey(years.groups, (group) => group.values.y_plus1_budget), byKey(average.groups, (group) => group.value), 'an average per year');
  assert.ok(years.groups.some((group: any) => group.key === null), 'the lines without a supplier are a group');
  console.log('ok - metrics equal one simple aggregate per metric');
}

async function testThenBy(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed, seed.users.admin);
  const crossed = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'paying_company', then_by: 'supplier', metric: 'y_budget', function: 'sum' });
  assert.equal(crossed.then_by, 'supplier');
  assert.equal(crossed.limit, 50, 'the default limit');
  assert.equal(crossed.group_count, 5, 'five combinations');
  assert.equal(crossed.others, undefined, 'none past the limit');
  assert.equal(crossed.truncated, false);
  const combination = (group: any) => `${group.key} × ${group.then_key}`;
  const expected: Record<string, number | null> = {};
  for (const company of [seed.companies.a, seed.companies.b]) {
    const simple = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'supplier', metric: 'y_budget', function: 'sum', filters: { paying_company: [company] } });
    for (const group of simple.groups) expected[`${company} × ${group.key}`] = group.value;
  }
  assert.deepEqual(Object.fromEntries(crossed.groups.map((group: any) => [combination(group), group.value])), expected, 'each combination as the simple aggregate filtered on its company');
  const blank = crossed.groups.find((group: any) => group.key === seed.companies.b && group.then_key === null);
  assert.ok(blank, 'the lines of company B without a supplier are a group of their own');
  assert.equal(blank.value, 150, 'the GBP line left out, as every sum');
  assert.ok('then_key' in blank, 'then_key null is said');

  const counted = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'paying_company', then_by: 'supplier' });
  assert.deepEqual(counted.groups.map((group: any) => group.count).reduce((x: number, y: number) => x + y, 0), LINES.length, 'counts add up to the lines');
  assert.deepEqual(Object.keys(counted.groups[0]), ['key', 'then_key', 'count'], 'a count crossed');

  const both = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'supplier', then_by: 'paying_company', metrics: COLUMNS, function: 'sum' });
  const one = both.groups.find((group: any) => group.key === seed.suppliers.s1 && group.then_key === seed.companies.a);
  assert.deepEqual(one.values, { y_budget: 1000 + 500 * USD_RATE, y_review: 1100 + 520 * USD_RATE, y_plus1_budget: 1200 + 600 * USD_RATE }, 'metrics and then_by together');
  console.log('ok - then_by crosses two fields, the null combination included');
}

async function testLimitAndOthers(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed, seed.users.admin);
  const top = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'paying_company', then_by: 'supplier', metric: 'y_budget', function: 'sum', limit: 2 });
  assert.deepEqual(top.groups.map((group: any) => [group.key, group.then_key]), [[seed.companies.b, seed.suppliers.s2], [seed.companies.a, seed.suppliers.s1]], 'the two largest');
  assert.equal(top.limit, 2);
  assert.equal(top.group_count, 5);
  assert.equal(top.others.groups, 3, 'three groups in others');
  assert.equal(top.truncated, true, 'the groups are cut');
  assert.equal(top.complete, true, 'the figures stay whole');
  assert.equal(top.groups.length + top.others.groups, top.group_count);
  assert.equal(top.others.count, 4, 'the lines of the three other groups');
  const counted = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'paying_company', then_by: 'supplier', limit: 2 });
  assert.equal(counted.groups.reduce((sum: number, group: any) => sum + group.count, 0) + counted.others.count, LINES.length, 'the line counts add up');
  assert.deepEqual(counted.others, { count: 3, groups: 3 }, 'a count: others holds the lines and the groups');
  assert.equal(top.groups.reduce((sum: number, group: any) => sum + cents(group.value), 0) + cents(top.others.value), cents(top.overall.value), 'the amounts add up to overall');

  const multi = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'supplier', metrics: COLUMNS, function: 'sum', limit: 1 });
  assert.equal(multi.groups.length, 1, 'a limit without then_by');
  for (const key of COLUMNS) {
    assert.equal(cents(multi.groups[0].values[key]) + cents(multi.others.values[key]), cents(multi.overall.values[key]), `${key}: group and others add up`);
  }
  console.log('ok - limit keeps the first groups, others sums the rest');
}

async function refused(promise: Promise<unknown>, status: number, pattern: RegExp, what: string) {
  await assert.rejects(promise, (error: any) => {
    assert.equal(error?.status, status, `${what}: status`);
    assert.match(error.message, pattern, `${what}: in words`);
    return true;
  }, what);
}

async function testRefusals(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed, seed.users.admin);
  const run = (input: Record<string, unknown>) => harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'paying_company', ...input });
  await refused(run({ then_by: 'project_stream' }), 400, /several streams under the combination.*Group by project_stream alone/, 'a multi-valued then_by');
  await refused(run({ group_by: 'project_category', then_by: 'supplier' }), 400, /several categories under the combination/, 'a multi-valued group_by in a crossing');
  await refused(run({ metrics: ['y_budget', 'y_budget_cost_per_fte'], function: 'sum' }), 400, /y_budget_cost_per_fte is a ratio .* does not take metrics\. Ask it as metric alone/, 'a ratio in metrics');
  await refused(run({ metric: 'y_budget_day_rate', then_by: 'supplier' }), 400, /y_budget_day_rate is a ratio .* does not take then_by/, 'a ratio with then_by');
  await refused(run({ metric: 'y_budget', metrics: COLUMNS, function: 'sum' }), 400, /metric .* or metrics .*not both/, 'metric and metrics');
  await refused(run({ metrics: COLUMNS }), 400, /function sum, avg, min or max/, 'a count with metrics');
  await refused(run({ metrics: ['y_budget', 'supplier'], function: 'sum' }), 400, /supplier is not a metric of budget lines/, 'a field that is no metric');
  await refused(run({ then_by: 'paying_company' }), 400, /names the group_by field again/, 'the same field twice');
  await refused(run({ then_by: 'supplier', limit: 101 }), 400, /from 1 to 100/, 'a limit past the cap');
  await refused(harness.aggregates.execute(ctx, { entity_type: 'tasks', group_by: 'status', then_by: 'priority' }), 400, /budget lines only/, 'another family');

  // The engine's own limits come back as a refusal in words.
  const original = harness.budgetLines.summaryAggregate;
  harness.budgetLines.summaryAggregate = async () => { throw new BadRequestException('Aggregate: at most 8 measures with group keys.'); };
  try {
    await refused(run({ metrics: COLUMNS, function: 'sum' }), 400, /^The server cannot compute this aggregate in one call: at most 8 measures with group keys\. Ask fewer metrics/, 'the engine limit');
  } finally {
    harness.budgetLines.summaryAggregate = original;
  }
  console.log('ok - refused in words');
}

/** A person limited to company A crosses the lines of company A only, as an administrator filtered on it. */
async function testLimitedPerson(harness: Harness, runner: QueryRunner, seed: Seed) {
  if (!(await runner.query(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`))[0].present) {
    if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
    console.log('skip - kanap_data_limited not installed');
    return;
  }
  const input = { entity_type: 'budget_lines', group_by: 'paying_company', then_by: 'supplier', metrics: COLUMNS, function: 'sum' };
  const expected = await harness.aggregates.execute(context(runner, seed, seed.users.admin), { ...input, filters: { paying_company: [seed.companies.a] } });
  assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [seed.users.limited]))[0].mode, 'limited');
  const result = await harness.aggregates.execute(context(runner, seed, seed.users.limited), input);
  assert.deepEqual(result.groups, expected.groups, 'the combinations of company A only');
  assert.deepEqual(result.overall, expected.overall, 'and their total');
  assert.ok(result.groups.every((group: any) => group.key === seed.companies.a));
  assert.equal(result.data_access, 'limited', 'said within their access');
  assert.match(result.data_access_note, /access/i);
  assert.equal(result.amounts_currency, 'EUR');
  console.log('ok - a limited person crosses their lines only');
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
      await testMetricsAsSimpleAggregates(harness, runner, s);
      await testThenBy(harness, runner, s);
      await testLimitAndOthers(harness, runner, s);
      await testRefusals(harness, runner, s);
    });
    // `data_access_apply` limits the rest of its transaction: a transaction of its own.
    await inTransaction(harness, (runner, s) => testLimitedPerson(harness, runner, s));
  } finally {
    await harness.app.close();
  }
  console.log('ai-budget-multi.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
