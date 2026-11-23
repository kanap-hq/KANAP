import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { AMOUNT_MEASURES, MEASURE_FREEZE_COLUMN, type AmountMeasure } from '../amounts-write.util';
import { readEntryChecks, type LineEntryCheck } from '../budget-line-entry-check';
import { describeAiEntityFilters } from '../../ai/query/ai-filter-description.util';
import { resolveAiEntityRegistry } from '../../ai/query/registries';

// "Quantity and price expected" read on the budget lines (lot B12a, pass 2), against the database,
// on one seeded tenant in a rolled-back transaction:
// - parity: the per-line reader (`readEntryChecks`), the list's field `entry_check` (each line,
//   the filter, its values, a page with it, the rows the list draws) and a written truth table
//   agree, on an account that sets it, a consolidation account that sets it, both, neither; no
//   consolidation chart; a consolidation number missing or only in another chart; a column built
//   as quantity × price, spread, entered by month, without a round, copied from a quantity × price
//   column, copied from another column; a zero total; a net of zero (+100, -100); a column off in
//   the settings; a frozen column (of one nature only); several years; a version after the end of
//   validity; OPEX and CAPEX;
// - changes: the column turned on, the consolidation chart removed, the setting removed, the
//   column rebuilt as quantity × price, the column unfrozen;
// - the route `GET /budget-lines/:id/entry-check`: the expectation, its level and the columns to
//   check; the consolidation account named for a reader of the accounts only;
// - Kad and the MCP server: `entry_check` filters, counts as the hygiene tile's aggregate, lists
//   the same lines, shows on each line and in the detail, for a reader of budget without accounts too;
// - a person limited to one company reads, counts and lists the lines of that company only.
// @database-spec: boots the application context, so run-ci-tests.js runs this file in a database lane.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'budget-line-entry-check-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const Y = new Date().getFullYear();

type Harness = { app: any; dataSource: DataSource; aggregates: any; queries: any; policy: any; budgetLines: any; controller: any };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for budget-line-entry-check.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../../ai/query/ai-query.executor');
  const { AiAggregateExecutor } = require('../../ai/query/ai-aggregate.executor');
  const { AiPolicyService } = require('../../ai/ai-policy.service');
  const { BudgetLinesService } = require('../budget-lines.service');
  const { BudgetLinesController } = require('../budget-lines.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return {
    app,
    dataSource: app.get(DataSource),
    aggregates: app.get(AiAggregateExecutor),
    queries: app.get(AiQueryExecutor),
    policy: app.get(AiPolicyService),
    budgetLines: app.get(BudgetLinesService),
    controller: app.get(BudgetLinesController),
  };
}

// ----- the seeded tenant -----

type AccountKey = 'tick' | 'cons' | 'both' | 'none' | 'noCons' | 'outside' | 'otherChart';
type Method = 'computed' | 'spread' | 'manual' | 'copied' | null;
/** One column of one version: its months' amounts (January first), how it was made, whether its round has lines. */
type Column = { year: number; measure: AmountMeasure; months: number[]; method: Method; lines?: boolean };
type LineDef = {
  label: string;
  nature: 'opex' | 'capex';
  account: AccountKey | null;
  company: 'a' | 'b';
  disabledAt?: string;
  columns: Column[];
};
type Expect = { level: 'account' | 'consolidation' | null; columns: Array<[number, AmountMeasure]> };

const qp = (year: number, measure: AmountMeasure = 'planned', total = 1200): Column => ({ year, measure, months: [total], method: 'computed', lines: true });
const spread = (year: number, measure: AmountMeasure = 'planned', total = 1200): Column => ({ year, measure, months: [total], method: 'spread' });
const monthly = (year: number, measure: AmountMeasure, months: number[]): Column => ({ year, measure, months, method: 'manual' });

/** The lines, and what the rule says of each (forecast off, the consolidation chart on, OPEX Y+1 budget frozen). */
const LINES: Array<LineDef & { expect: Expect }> = [
  { label: 'qp', nature: 'opex', account: 'tick', company: 'a', columns: [qp(Y)], expect: { level: 'account', columns: [] } },
  { label: 'spread', nature: 'opex', account: 'tick', company: 'b', columns: [spread(Y)], expect: { level: 'account', columns: [[Y, 'planned']] } },
  { label: 'monthly', nature: 'capex', account: 'tick', company: 'a', columns: [monthly(Y, 'planned', Array(12).fill(100))], expect: { level: 'account', columns: [[Y, 'planned']] } },
  { label: 'noround', nature: 'opex', account: 'tick', company: 'b', columns: [{ year: Y, measure: 'committed', months: [500], method: null }], expect: { level: 'account', columns: [[Y, 'committed']] } },
  // What a copy of a quantity × price column stores (`copiedColumnRecord`): computed from its copied lines.
  { label: 'copyQp', nature: 'opex', account: 'tick', company: 'a', columns: [qp(Y)], expect: { level: 'account', columns: [] } },
  // A copy of a spread column, or of lines whose calendar has no days: `copied`, its lines a reference.
  { label: 'copySpread', nature: 'opex', account: 'tick', company: 'b', columns: [{ year: Y, measure: 'planned', months: [1200], method: 'copied', lines: true }], expect: { level: 'account', columns: [[Y, 'planned']] } },
  { label: 'zero', nature: 'opex', account: 'tick', company: 'a', columns: [monthly(Y, 'planned', [0])], expect: { level: 'account', columns: [] } },
  { label: 'net0', nature: 'opex', account: 'tick', company: 'b', columns: [monthly(Y, 'planned', [100, -100])], expect: { level: 'account', columns: [] } },
  { label: 'forecast', nature: 'opex', account: 'tick', company: 'a', columns: [monthly(Y, 'forecast', [500])], expect: { level: 'account', columns: [] } },
  { label: 'frozen', nature: 'opex', account: 'tick', company: 'b', columns: [monthly(Y + 1, 'planned', [900])], expect: { level: 'account', columns: [] } },
  { label: 'frozenCapex', nature: 'capex', account: 'tick', company: 'a', columns: [monthly(Y + 1, 'planned', [900])], expect: { level: 'account', columns: [[Y + 1, 'planned']] } },
  {
    label: 'multi', nature: 'opex', account: 'tick', company: 'b',
    columns: [qp(Y - 1), spread(Y), monthly(Y + 2, 'actual', [300])],
    expect: { level: 'account', columns: [[Y, 'planned'], [Y + 2, 'actual']] },
  },
  { label: 'cut', nature: 'opex', account: 'tick', company: 'a', disabledAt: `${Y - 1}-06-30`, columns: [qp(Y - 1), spread(Y)], expect: { level: 'account', columns: [] } },
  { label: 'cons', nature: 'opex', account: 'cons', company: 'b', columns: [spread(Y)], expect: { level: 'consolidation', columns: [[Y, 'planned']] } },
  { label: 'consQp', nature: 'capex', account: 'cons', company: 'a', columns: [qp(Y)], expect: { level: 'consolidation', columns: [] } },
  { label: 'consCapex', nature: 'capex', account: 'cons', company: 'b', columns: [monthly(Y, 'committed', [400])], expect: { level: 'consolidation', columns: [[Y, 'committed']] } },
  { label: 'both', nature: 'opex', account: 'both', company: 'a', columns: [spread(Y)], expect: { level: 'account', columns: [[Y, 'planned']] } },
  { label: 'none', nature: 'opex', account: 'none', company: 'b', columns: [spread(Y)], expect: { level: null, columns: [] } },
  { label: 'noCons', nature: 'opex', account: 'noCons', company: 'a', columns: [spread(Y)], expect: { level: null, columns: [] } },
  { label: 'outside', nature: 'opex', account: 'outside', company: 'b', columns: [spread(Y)], expect: { level: null, columns: [] } },
  { label: 'otherChart', nature: 'opex', account: 'otherChart', company: 'a', columns: [spread(Y)], expect: { level: null, columns: [] } },
  { label: 'noAccount', nature: 'opex', account: null, company: 'b', columns: [spread(Y)], expect: { level: null, columns: [] } },
];

type Seed = {
  tenantId: string;
  users: { admin: string; budgetOnly: string; budgetAndAccounts: string; limited: string };
  accounts: Record<AccountKey, string>;
  lines: Record<string, { id: string; ref: string; company: 'a' | 'b' }>;
  rounds: Record<string, string>;
  consolidationChart: string;
};

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function seedRole(runner: QueryRunner, tenantId: string, name: string, rights: string[]): Promise<string> {
  const roleId = await insertId(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, $2, 'entry check spec', false, false)`,
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
     VALUES ($1, $2, 'Entry', 'Check', $3, $4, false, 'enabled', $5)`,
    [id, tenantId, `entry-check-${id.slice(0, 8)}@example.test`, roleId, mode],
  );
  return id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `entry-check-${tag}`, `Entry check ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const budgetAndAccountsRole = await seedRole(runner, tenantId, 'Budget and accounts', ['budget', 'accounts']);
  const companies = {
    a: await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Brest', 'enabled')`, [tenantId, `Company A ${tag}`]),
    b: await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Quimper', 'enabled')`, [tenantId, `Company B ${tag}`]),
  };
  const users = {
    admin: await seedUser(runner, tenantId, await seedRole(runner, tenantId, 'Administrator', [])),
    budgetOnly: await seedUser(runner, tenantId, await seedRole(runner, tenantId, 'Budget only', ['budget'])),
    budgetAndAccounts: await seedUser(runner, tenantId, budgetAndAccountsRole),
    limited: await seedUser(runner, tenantId, budgetAndAccountsRole, 'limited'),
  };
  await runner.query(
    `INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access) VALUES ($1, $2, 'company', $3, 'read')`,
    [tenantId, users.limited, companies.a],
  );

  const chart = (code: string) => insertId(runner,
    `INSERT INTO chart_of_accounts (tenant_id, code, name, scope) VALUES ($1, $2, $2, 'GLOBAL')`, [tenantId, `${code}-${tag}`]);
  const local = await chart('LOCAL');
  const other = await chart('OTHER');
  const consolidationChart = await chart('IFRS');
  await runner.query(`UPDATE chart_of_accounts SET is_consolidation = true WHERE tenant_id = $1 AND id = $2`, [tenantId, consolidationChart]);
  const account = (coa: string, number: number, name: string, expected: boolean, consolidation: number | null) => insertId(runner,
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, quantity_price_expected, consolidation_account_number)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, coa, number, name, expected ? true : null, consolidation]);
  // The consolidation chart: 2400 sets it, 2500 does not. 2700 sets it in another local chart only.
  await account(consolidationChart, 2400, 'External services', true, null);
  await account(consolidationChart, 2500, 'Purchases', false, null);
  await account(other, 2700, 'Not a consolidation account', true, null);
  const accounts: Record<AccountKey, string> = {
    tick: await account(local, 621100, 'Temporary staff', true, 2500),
    cons: await account(local, 622100, 'Fees', false, 2400),
    both: await account(local, 622200, 'Commissions', true, 2400),
    none: await account(local, 623000, 'Advertising', false, 2500),
    noCons: await account(local, 624000, 'Transport', false, null),
    outside: await account(local, 625000, 'Travel', false, 9999),
    otherChart: await account(local, 626000, 'Postage', false, 2700),
  };
  // OPEX budget of Y+1 frozen; the CAPEX one is not.
  await runner.query(
    `INSERT INTO freeze_states (tenant_id, budget_year, scope, column_key, is_frozen) VALUES ($1, $2, 'opex', $3, true)`,
    [tenantId, Y + 1, MEASURE_FREEZE_COLUMN.planned],
  );

  const lines: Seed['lines'] = {};
  const rounds: Record<string, string> = {};
  for (const [index, line] of LINES.entries()) {
    const itemNumber = index + 1;
    const id = await insertId(runner,
      `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, paying_company_id, account_id, disabled_at)
       VALUES ($1, $2, $3, $4, 'EUR', $5::date, $6, $7, $8, $9::timestamptz)`,
      [tenantId, line.nature, itemNumber, `Line ${line.label}`, `${Y - 2}-01-01`, line.disabledAt ? 'disabled' : 'enabled', companies[line.company],
        line.account ? accounts[line.account] : null, line.disabledAt ? `${line.disabledAt}T12:00:00Z` : null]);
    lines[line.label] = { id, ref: `BL-${itemNumber}`, company: line.company };
    const versions = new Map<number, string>();
    for (const column of line.columns) {
      let versionId = versions.get(column.year);
      if (!versionId) {
        versionId = await insertId(runner,
          `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year) VALUES ($1, $2, $3, $4::date, $5)`,
          [tenantId, id, `V${column.year}`, `${column.year}-01-01`, column.year]);
        versions.set(column.year, versionId);
      }
      for (const [month, amount] of column.months.entries()) {
        await runner.query(
          `INSERT INTO spend_amounts (tenant_id, version_id, period, ${column.measure}) VALUES ($1, $2, make_date($3, $4, 1), $5::numeric)`,
          [tenantId, versionId, column.year, month + 1, amount],
        );
      }
      if (!column.method) continue;
      const roundId = await insertId(runner,
        `INSERT INTO spend_round_inputs (tenant_id, version_id, measure, period_start, period_end, method)
         VALUES ($1, $2, $3, make_date($4, 1, 1), make_date($4, 12, 31), $5)`,
        [tenantId, versionId, column.measure, column.year, column.method]);
      rounds[`${line.label}:${column.year}:${column.measure}`] = roundId;
      if (column.lines) await addLine(runner, tenantId, roundId, column.year);
    }
  }
  return { tenantId, users, accounts, lines, rounds, consolidationChart };
}

async function addLine(runner: QueryRunner, tenantId: string, roundId: string, year: number) {
  await runner.query(
    `INSERT INTO spend_round_input_lines (tenant_id, round_input_id, sort, label, quantity_unit, quantity, unit_price, price_basis, frequency, period_start, period_end)
     VALUES ($1, $2, 1, 'Licences', 'pieces', 2, 600, 'per_piece', 'once', make_date($3, 1, 1), make_date($3, 12, 31))`,
    [tenantId, roundId, year],
  );
}

// ----- reads -----

/** The truth table of the lines, after `changes` (label → expectation). */
function truth(changes: Partial<Record<string, Expect>> = {}): Map<string, Expect> {
  return new Map(LINES.map((line) => [line.label, changes[line.label] ?? line.expect]));
}

const labelOf = (s: Seed) => new Map(Object.entries(s.lines).map(([label, line]) => [line.id, label]));
const ALL_LINES = { includeDisabled: true };

/** What the reader says, in the truth table's shape. */
async function readerTable(runner: QueryRunner, s: Seed): Promise<Map<string, Expect>> {
  const checks = await readEntryChecks(runner.manager, s.tenantId, Object.values(s.lines).map((line) => line.id), { accounts: true });
  const labels = labelOf(s);
  return new Map([...checks].map(([id, check]) => [labels.get(id)!, { level: check.level, columns: check.columns.map((c) => [c.year, c.measure] as [number, AmountMeasure]) }]));
}

/** The list's field on every line (one aggregate grouped by line), label → value. */
async function listField(h: Harness, runner: QueryRunner, s: Seed, access = { accounts: true }): Promise<Map<string, string | null>> {
  const result = await h.budgetLines.summaryAggregate(ALL_LINES, { groupBy: ['id', 'entry_check'], measures: [] }, { manager: runner.manager, access });
  const labels = labelOf(s);
  return new Map(result.groups.map((group: any) => [labels.get(group.keys[0])!, group.keys[1] ?? null]));
}

/** The tile's count: the list's aggregate with the filter, Enabled lines (the list's default), one statement. */
async function tileCount(h: Harness, runner: QueryRunner, access = { accounts: true }): Promise<number> {
  const result = await h.budgetLines.summaryAggregate(
    { filters: { entry_check: { filterType: 'set', values: ['to_check'] } }, status: 'enabled' },
    { groupBy: [], measures: [] },
    { manager: runner.manager, access },
  );
  return result.total.count;
}

const toCheckLabels = (table: Map<string, Expect>) => [...table].filter(([, e]) => e.columns.length > 0).map(([label]) => label).sort();

async function assertAgree(h: Harness, runner: QueryRunner, s: Seed, expected: Map<string, Expect>, what: string) {
  assert.deepEqual(Object.fromEntries(await readerTable(runner, s)), Object.fromEntries(expected), `${what}: the reader follows the truth table`);
  const field = await listField(h, runner, s);
  const fromList = Object.fromEntries([...field].map(([label, value]) => [label, value]));
  const fromTruth = Object.fromEntries([...expected].map(([label, e]) => [label, e.columns.length > 0 ? 'to_check' : null]));
  assert.deepEqual(fromList, fromTruth, `${what}: the list's field agrees with the reader`);
}

async function savepoint(runner: QueryRunner, fn: () => Promise<void>) {
  await runner.query('SAVEPOINT entry_check');
  try {
    await fn();
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT entry_check');
  }
}

// ----- tests -----

async function testParity(h: Harness, runner: QueryRunner, s: Seed) {
  const expected = truth();
  await assertAgree(h, runner, s, expected, 'as seeded');
  const checks = await readEntryChecks(runner.manager, s.tenantId, [s.lines.cons.id, s.lines.qp.id, s.lines.none.id], { accounts: true });
  assert.deepEqual(checks.get(s.lines.cons.id)!.consolidation_account, { number: 2400, name: 'External services' }, 'the consolidation account that sets it');
  assert.equal(checks.get(s.lines.qp.id)!.consolidation_account, null, 'no consolidation account at the account level');
  assert.deepEqual(checks.get(s.lines.none.id), { expected: false, level: null, consolidation_account: null, columns: [], to_check: false });
  const hidden = await readEntryChecks(runner.manager, s.tenantId, [s.lines.cons.id]);
  assert.equal(hidden.get(s.lines.cons.id)!.consolidation_account, null, 'without the accounts, the level only');

  const ids = Object.values(s.lines).map((line) => line.id);
  const rows = await h.budgetLines.summaryRowsByIds(ids, { years: [Y - 1, Y, Y + 1, Y + 2] }, { manager: runner.manager });
  const labels = labelOf(s);
  assert.deepEqual(
    Object.fromEntries(rows.map((row: any) => [labels.get(row.id), row.entry_check])),
    Object.fromEntries([...expected].map(([label, e]) => [label, e.columns.length > 0 ? 'to_check' : null])),
    'the rows the list draws carry the field',
  );

  const filtered = await h.budgetLines.summary({ ...ALL_LINES, shape: 'grid', limit: 100, filters: JSON.stringify({ entry_check: { filterType: 'set', values: ['to_check'] } }) },
    { manager: runner.manager, access: { accounts: true } });
  assert.deepEqual(filtered.items.map((item: any) => labels.get(item.id)).sort(), toCheckLabels(expected), 'the filter keeps the lines to check');
  assert.ok(filtered.items.every((item: any) => item.entry_check === 'to_check'), 'the grid rows carry the field');
  const blank = await h.budgetLines.summaryAggregate({ ...ALL_LINES, filters: { entry_check: { filterType: 'set', values: [null] } } },
    { groupBy: [], measures: [] }, { manager: runner.manager, access: { accounts: true } });
  assert.equal(blank.total.count, LINES.length - toCheckLabels(expected).length, 'the blank value keeps the others');
  const sorted = await h.budgetLines.summary({ ...ALL_LINES, shape: 'grid', limit: 100, sort: 'entry_check:asc' }, { manager: runner.manager, access: { accounts: true } });
  assert.deepEqual(sorted.items.slice(0, toCheckLabels(expected).length).map((item: any) => labels.get(item.id)).sort(), toCheckLabels(expected), 'the field sorts, blanks last');
  const values = await h.budgetLines.summaryFilterValues({ ...ALL_LINES, fields: 'entry_check' }, { manager: runner.manager, access: { accounts: true } });
  assert.deepEqual(values.entry_check, ['to_check', null], 'its values');
  // Every line to check is Enabled this year but `cut` (not to check): the tile counts them all.
  assert.equal(await tileCount(h, runner), toCheckLabels(expected).length, 'the tile\'s aggregate counts the lines to check, in one statement');
  console.log('ok - the reader, the list\'s field, filter, values, sort, rows and the tile\'s count agree with the truth table');
}

async function testChanges(h: Harness, runner: QueryRunner, s: Seed) {
  await savepoint(runner, async () => {
    await runner.query(`UPDATE tenants SET metadata = metadata || '{"budget_columns":{"enabled":{"forecast":true}}}'::jsonb WHERE id = $1`, [s.tenantId]);
    await assertAgree(h, runner, s, truth({ forecast: { level: 'account', columns: [[Y, 'forecast']] } }), 'the forecast column on');
  });
  await savepoint(runner, async () => {
    await runner.query(`UPDATE chart_of_accounts SET is_consolidation = false WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.consolidationChart]);
    const none: Expect = { level: null, columns: [] };
    await assertAgree(h, runner, s, truth({ cons: none, consQp: none, consCapex: none }), 'no consolidation chart');
  });
  await savepoint(runner, async () => {
    await runner.query(`UPDATE accounts SET quantity_price_expected = NULL WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.accounts.tick]);
    const none: Expect = { level: null, columns: [] };
    const changes = Object.fromEntries(LINES.filter((line) => line.account === 'tick').map((line) => [line.label, none]));
    await assertAgree(h, runner, s, truth(changes), 'the setting removed');
  });
  await savepoint(runner, async () => {
    const round = s.rounds[`spread:${Y}:planned`];
    await runner.query(`UPDATE spend_round_inputs SET method = 'computed' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, round]);
    await addLine(runner, s.tenantId, round, Y);
    await assertAgree(h, runner, s, truth({ spread: { level: 'account', columns: [] } }), 'the column rebuilt as quantity and price');
  });
  await savepoint(runner, async () => {
    await runner.query(`UPDATE freeze_states SET is_frozen = false WHERE tenant_id = $1`, [s.tenantId]);
    await assertAgree(h, runner, s, truth({ frozen: { level: 'account', columns: [[Y + 1, 'planned']] } }), 'the column unfrozen');
  });
  console.log('ok - column on, no consolidation chart, setting removed, column rebuilt, column unfrozen');
}

function routeContext(runner: QueryRunner, permissions: Record<string, string>) {
  return { manager: runner.manager, isAdmin: false, permissions };
}

async function testRoute(h: Harness, runner: QueryRunner, s: Seed) {
  const reader = routeContext(runner, { budget: 'reader', accounts: 'reader' });
  const cons = await h.controller.entryCheck(s.lines.cons.ref, reader);
  assert.deepEqual(cons, {
    id: s.lines.cons.id,
    reference: s.lines.cons.ref,
    expected: true,
    level: 'consolidation',
    consolidation_account: { number: 2400, name: 'External services' },
    columns: [{ year: Y, measure: 'planned' }],
    to_check: true,
  });
  const multi = await h.controller.entryCheck(s.lines.multi.id, reader);
  assert.deepEqual(multi.columns, [{ year: Y, measure: 'planned' }, { year: Y + 2, measure: 'actual' }], 'by year, by uuid');
  const conform = await h.controller.entryCheck(s.lines.qp.ref, reader);
  assert.deepEqual([conform.expected, conform.level, conform.columns, conform.to_check], [true, 'account', [], false], 'expected and conform');
  const none = await h.controller.entryCheck(s.lines.none.ref, reader);
  assert.deepEqual([none.expected, none.level, none.to_check], [false, null, false], 'not expected');
  // A reader of budget without accounts: the warning and its level, never the consolidation account.
  const budgetOnly = await h.controller.entryCheck(s.lines.cons.ref, routeContext(runner, { budget: 'reader' }));
  assert.deepEqual([budgetOnly.level, budgetOnly.consolidation_account, budgetOnly.to_check], ['consolidation', null, true], 'no number or name without the accounts');
  await assert.rejects(h.controller.entryCheck('BL-9999', reader), (error: any) => error?.status === 404, 'a missing line is 404');
  // The same count for a reader of budget only (the field is not gated on the accounts).
  assert.equal(await tileCount(h, runner, { accounts: false }), toCheckLabels(truth()).length, 'the tile counts the same lines without the accounts');
  console.log('ok - the route: expectation, level, columns; the consolidation account for a reader of the accounts only');
}

function aiContext(runner: QueryRunner, s: Seed, userId: string) {
  return { tenantId: s.tenantId, userId, isPlatformHost: false, surface: 'mcp' as const, authMethod: 'api_key' as const, manager: runner.manager };
}

async function testKad(h: Harness, runner: QueryRunner, s: Seed) {
  const expected = toCheckLabels(truth());
  for (const [who, userId, accounts] of [['an administrator', s.users.admin, true], ['a reader of budget only', s.users.budgetOnly, false]] as const) {
    const ctx = aiContext(runner, s, userId);
    const registry = await resolveAiEntityRegistry(ctx, 'budget_lines', (entityType: any) => h.policy.canReadEntityType(ctx, entityType, runner.manager));
    assert.ok(registry.fields.entry_check, `${who}: the field is in the registry`);
    const description = describeAiEntityFilters('budget_lines', registry);
    assert.ok(description.fields.some((field) => field.field === 'entry_check'), `${who}: described`);
    const counted = await h.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'nature', filters: { entry_check: ['to_check'] } });
    assert.equal(counted.total, await tileCount(h, runner, { accounts }), `${who}: aggregate_entities counts as the tile`);
    const listed = await h.queries.execute(ctx, { entity_type: 'budget_lines', filters: { entry_check: ['to_check'] }, limit: 50 });
    assert.deepEqual(listed.items.map((item: any) => item.label.replace(/^Line /, '')).sort(), expected, `${who}: query_entities lists the tile's lines`);
    assert.ok(listed.items.every((item: any) => item.metadata.entry_check === 'to_check'), `${who}: each line says it`);
    const detail = await h.queries.executeDetail(ctx, { entity_type: 'budget_lines', entity_id: s.lines.cons.ref });
    const entry: LineEntryCheck = detail.data.quantity_price_entry as LineEntryCheck;
    assert.deepEqual([entry.expected, entry.level, entry.to_check, entry.columns], [true, 'consolidation', true, [{ year: Y, measure: 'planned' }]], `${who}: the detail`);
    assert.deepEqual(entry.consolidation_account, accounts ? { number: 2400, name: 'External services' } : null, `${who}: the consolidation account with the accounts only`);
    const withheld = (detail.data.quantity_price_entry as any).consolidation_account_withheld;
    if (accounts) assert.equal(withheld, undefined, `${who}: nothing withheld`);
    else assert.match(withheld, /right on accounts/, `${who}: the detail says why it is not named`);
  }
  console.log('ok - Kad and the MCP server: the field filters, counts as the tile, lists the same lines, shows in the detail');
}

async function testLimitedPerson(h: Harness, runner: QueryRunner, s: Seed) {
  if (!(await runner.query(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`))[0].present) {
    if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
    console.log('skip - kanap_data_limited not installed');
    return;
  }
  const companyA = toCheckLabels(truth()).filter((label) => s.lines[label].company === 'a');
  assert.ok(companyA.length > 0 && companyA.length < toCheckLabels(truth()).length, 'company A has some of the lines to check');
  assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [s.users.limited]))[0].mode, 'limited');
  const labels = labelOf(s);
  assert.equal(await tileCount(h, runner), companyA.length, 'the tile counts their lines only');
  const field = await listField(h, runner, s);
  assert.deepEqual([...field].filter(([, value]) => value === 'to_check').map(([label]) => label).sort(), companyA, 'the list');
  const checks = await readEntryChecks(runner.manager, s.tenantId, Object.values(s.lines).map((line) => line.id), { accounts: true });
  assert.deepEqual([...checks].filter(([, check]) => check.to_check).map(([id]) => labels.get(id)).sort(), companyA, 'the reader reads their lines only');
  const reader = routeContext(runner, { budget: 'reader', accounts: 'reader' });
  assert.equal((await h.controller.entryCheck(s.lines.monthly.ref, reader)).to_check, true, 'the route on a line of company A');
  await assert.rejects(h.controller.entryCheck(s.lines.spread.ref, reader), (error: any) => error?.status === 404, 'a line of company B is 404, as a missing one');
  const ctx = aiContext(runner, s, s.users.limited);
  const counted = await h.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'nature', filters: { entry_check: ['to_check'] } });
  assert.equal(counted.total, companyA.length, 'Kad counts their lines only');
  assert.equal(counted.data_access, 'limited', 'said within their access');
  console.log('ok - a person limited to one company reads, counts and lists the lines of that company only');
}

function testFreezeKeys() {
  // The settings loader maps a freeze's column key back to its column with this table.
  assert.deepEqual(AMOUNT_MEASURES.map((measure) => MEASURE_FREEZE_COLUMN[measure]), ['budget', 'revision', 'forecast', 'actual', 'landing']);
}

async function inTransaction(h: Harness, fn: (runner: QueryRunner, s: Seed) => Promise<void>) {
  const runner = h.dataSource.createQueryRunner();
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
  testFreezeKeys();
  const h = await createHarness();
  try {
    await inTransaction(h, async (runner, s) => {
      await testParity(h, runner, s);
      await testChanges(h, runner, s);
      await testRoute(h, runner, s);
      await testKad(h, runner, s);
    });
    // `data_access_apply` limits the rest of its transaction: a transaction of its own.
    await inTransaction(h, (runner, s) => testLimitedPerson(h, runner, s));
  } finally {
    await h.app.close();
  }
  console.log('budget-line-entry-check.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
