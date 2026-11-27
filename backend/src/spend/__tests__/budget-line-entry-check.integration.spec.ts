import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { AMOUNT_MEASURES, MEASURE_FREEZE_COLUMN, type AmountMeasure } from '../amounts-write.util';
import { loadEntryCheckSettings, readAccountExpectations, readColumnsToCheckOnAnyAccount, readEntryChecks } from '../budget-line-entry-check';
import { loadCatalog } from '../budget-file/load';
import { describeAiEntityFilters } from '../../ai/query/ai-filter-description.util';
import { resolveAiEntityRegistry } from '../../ai/query/registries';

// "Quantity and price expected" read on the budget lines (lot B12a, pass 2), against the database,
// on one seeded tenant in a rolled-back transaction:
// - parity: the per-line reader (`readEntryChecks`), the list's check `quantity_price` of the field
//   `to_check` (each line,
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
// - the one field `to_check` (D12): a line failing both checks holds both names; a filter on one
//   check keeps the lines failing it, and evaluates that check alone (the statement reads no other);
// - Kad and the MCP server: `to_check` filters, counts as the hygiene tile's aggregate, lists
//   the same lines, shows on each line and in the detail, for a reader of budget without accounts too;
// - a person limited to one company reads, counts and lists the lines of that company only, with the
//   same answers on them as with every row readable (the reader, the field, its filter, sort and
//   values, as seeded and after each change), though both read the columns line by line then;
// - before a write: the accounts that expect it (`readAccountExpectations`, the budget
//   file's catalog) and the columns a move onto such an account leaves to check
//   (`readColumnsToCheckOnAnyAccount`) are what the reader says once the write is made.
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
  // A round left `computed` without lines: to check, the rule reads the lines (last, to keep the references above).
  { label: 'computedNoLines', nature: 'opex', account: 'tick', company: 'a', columns: [{ year: Y, measure: 'planned', months: [1200], method: 'computed' }], expect: { level: 'account', columns: [[Y, 'planned']] } },
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

/** The list's field on every line (one aggregate grouped by line), label → value (the names joined). */
async function listField(h: Harness, runner: QueryRunner, s: Seed, access = { accounts: true }): Promise<Map<string, string | null>> {
  const result = await h.budgetLines.summaryAggregate(ALL_LINES, { groupBy: ['id', 'to_check'], measures: [] }, { manager: runner.manager, access });
  const labels = labelOf(s);
  return new Map(result.groups.map((group: any) => [labels.get(group.keys[0])!, group.keys[1] ?? null]));
}

/** The tile's count of one check: the list's aggregate with the filter, Enabled lines (the list's default), one statement. */
async function tileCount(h: Harness, runner: QueryRunner, access = { accounts: true }, check = 'quantity_price'): Promise<number> {
  const result = await h.budgetLines.summaryAggregate(
    { filters: { to_check: { filterType: 'set', values: [check] } }, status: 'enabled' },
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
  const fromTruth = Object.fromEntries([...expected].map(([label, e]) => [label, e.columns.length > 0 ? 'quantity_price' : null]));
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
  assert.equal((await loadEntryCheckSettings(runner.manager, s.tenantId)).lineByLine, false, 'every row readable: one join over the tenant');
  const expected = truth();
  await assertAgree(h, runner, s, expected, 'as seeded');
  const checks = await readEntryChecks(runner.manager, s.tenantId, [s.lines.cons.id, s.lines.qp.id, s.lines.none.id], { accounts: true });
  assert.deepEqual(checks.get(s.lines.cons.id)!.consolidation_account, { number: 2400, name: 'External services' }, 'the consolidation account that sets it');
  assert.equal(checks.get(s.lines.qp.id)!.consolidation_account, null, 'no consolidation account at the account level');
  assert.deepEqual(checks.get(s.lines.none.id), { expected: false, level: null, units: null, consolidation_account: null, columns: [], unit_columns: [], to_check: false });
  const hidden = await readEntryChecks(runner.manager, s.tenantId, [s.lines.cons.id]);
  assert.equal(hidden.get(s.lines.cons.id)!.consolidation_account, null, 'without the accounts, the level only');

  const ids = Object.values(s.lines).map((line) => line.id);
  const rows = await h.budgetLines.summaryRowsByIds(ids, { years: [Y - 1, Y, Y + 1, Y + 2] }, { manager: runner.manager });
  const labels = labelOf(s);
  assert.deepEqual(
    Object.fromEntries(rows.map((row: any) => [labels.get(row.id), row.to_check])),
    Object.fromEntries([...expected].map(([label, e]) => [label, e.columns.length > 0 ? ['quantity_price'] : null])),
    'the rows the list draws carry the field',
  );

  const filtered = await h.budgetLines.summary({ ...ALL_LINES, shape: 'grid', limit: 100, filters: JSON.stringify({ to_check: { filterType: 'set', values: ['quantity_price'] } }) },
    { manager: runner.manager, access: { accounts: true } });
  assert.deepEqual(filtered.items.map((item: any) => labels.get(item.id)).sort(), toCheckLabels(expected), 'the filter keeps the lines to check');
  assert.ok(filtered.items.every((item: any) => item.to_check?.includes('quantity_price')), 'the grid rows carry the field');
  const blank = await h.budgetLines.summaryAggregate({ ...ALL_LINES, filters: { to_check: { filterType: 'set', values: [null] } } },
    { groupBy: [], measures: [] }, { manager: runner.manager, access: { accounts: true } });
  assert.equal(blank.total.count, LINES.length - toCheckLabels(expected).length, 'the blank value keeps the others');
  const sorted = await h.budgetLines.summary({ ...ALL_LINES, shape: 'grid', limit: 100, sort: 'to_check:asc' }, { manager: runner.manager, access: { accounts: true } });
  assert.deepEqual(sorted.items.slice(0, toCheckLabels(expected).length).map((item: any) => labels.get(item.id)).sort(), toCheckLabels(expected), 'the field sorts, blanks last');
  const values = await h.budgetLines.summaryFilterValues({ ...ALL_LINES, fields: 'to_check' }, { manager: runner.manager, access: { accounts: true } });
  assert.deepEqual(values.to_check, ['quantity_price', null], 'its values');
  // Every line to check is Enabled this year but `cut` (not to check): the tile counts them all.
  assert.equal(await tileCount(h, runner), toCheckLabels(expected).length, 'the tile\'s aggregate counts the lines to check, in one statement');
  console.log('ok - the reader, the list\'s field, filter, values, sort, rows and the tile\'s count agree with the truth table');
}

/** The statements `fn` runs, to see which checks a statement evaluates. */
async function statementsOf(runner: QueryRunner, fn: () => Promise<unknown>): Promise<string[]> {
  const manager: any = runner.manager;
  const query = manager.query;
  const seen: string[] = [];
  manager.query = (sql: string, params?: unknown[]) => {
    seen.push(sql);
    return query.call(manager, sql, params);
  };
  try {
    await fn();
  } finally {
    manager.query = query;
  }
  return seen;
}

/**
 * The one field `to_check` (D12): company B's chart of accounts differs from the lines' accounts',
 * so its lines with an account also fail `coa_mismatch`. A line failing both holds both names, in
 * the table's order; a filter on one check keeps the lines failing that one, and its statement
 * evaluates that check alone (the tile's count of `coa_mismatch` costs what `account_warning` did).
 */
async function testToCheckField(h: Harness, runner: QueryRunner, s: Seed) {
  await savepoint(runner, async () => {
    const otherChart = (await runner.query(`SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code LIKE 'OTHER-%'`, [s.tenantId]))[0].id;
    await runner.query(`UPDATE companies SET coa_id = $2 WHERE tenant_id = $1 AND id = (SELECT paying_company_id FROM spend_items WHERE tenant_id = $1 AND id = $3)`,
      [s.tenantId, otherChart, s.lines.spread.id]);
    const expected = truth();
    const qpLabels = toCheckLabels(expected);
    const coaLabels = LINES.filter((line) => line.company === 'b' && line.account).map((line) => line.label).sort();
    const names = (label: string) => [
      ...(qpLabels.includes(label) ? ['quantity_price'] : []),
      ...(coaLabels.includes(label) ? ['coa_mismatch'] : []),
    ];
    assert.ok(qpLabels.some((label) => coaLabels.includes(label)) && qpLabels.some((label) => !coaLabels.includes(label)), 'some lines fail both, some one');

    const labels = labelOf(s);
    const ids = Object.values(s.lines).map((line) => line.id);
    const rows = await h.budgetLines.summaryRowsByIds(ids, { years: [Y - 1, Y, Y + 1, Y + 2] }, { manager: runner.manager });
    assert.deepEqual(
      Object.fromEntries(rows.map((row: any) => [labels.get(row.id), row.to_check])),
      Object.fromEntries(LINES.map((line) => [line.label, names(line.label).length ? names(line.label) : null])),
      'each row names the checks it fails, quantity and price first',
    );
    const field = await listField(h, runner, s);
    assert.deepEqual(Object.fromEntries(field), Object.fromEntries(LINES.map((line) => [line.label, names(line.label).join(', ') || null])), 'the list\'s field, its names joined');

    const access = { manager: runner.manager, access: { accounts: true } };
    const listed = async (filter: unknown) => (await h.budgetLines.summary({ ...ALL_LINES, shape: 'grid', limit: 100, filters: JSON.stringify({ to_check: filter }) }, access))
      .items.map((item: any) => labels.get(item.id)).sort();
    assert.deepEqual(await listed({ filterType: 'set', values: ['coa_mismatch'] }), coaLabels, 'one check: the lines that fail it');
    assert.deepEqual(await listed({ filterType: 'set', values: ['quantity_price'] }), qpLabels, 'the other check: its lines, whatever the first');
    assert.deepEqual(await listed({ filterType: 'set', values: ['quantity_price', 'coa_mismatch'] }), [...new Set([...qpLabels, ...coaLabels])].sort(), 'both boxes');
    assert.deepEqual(await listed({ filterType: 'set', values: [null] }), LINES.map((line) => line.label).filter((label) => !names(label).length).sort(), 'the blank box: the lines that fail none');
    assert.deepEqual(await listed({ filterType: 'set', mode: 'exclude', values: ['quantity_price'] }), LINES.map((line) => line.label).filter((label) => names(label).join() !== 'quantity_price').sort(),
      'the exclusion keeps a line failing another check too');
    const accountWarning = await h.budgetLines.summary({ ...ALL_LINES, shape: 'grid', limit: 100, filters: JSON.stringify({ account_warning: { filterType: 'set', values: ['coa_mismatch'] } }) }, access);
    assert.deepEqual(accountWarning.items.map((item: any) => labels.get(item.id)).sort(), coaLabels, 'account_warning still reads the same check');
    const values = await h.budgetLines.summaryFilterValues({ ...ALL_LINES, fields: 'to_check' }, access);
    assert.deepEqual(values.to_check, ['coa_mismatch', 'quantity_price', null], 'its values: one per check');
    const sorted = await h.budgetLines.summary({ ...ALL_LINES, shape: 'grid', limit: 100, sort: 'to_check:asc' }, access);
    assert.deepEqual(sorted.items.map((item: any) => names(labels.get(item.id)!).join(', ') || null).filter((text: string | null, i: number, all: Array<string | null>) => i === 0 || text !== all[i - 1]),
      ['coa_mismatch', 'quantity_price', 'quantity_price, coa_mismatch', null], 'the sort: by the joined names, blanks last');

    const coaEnabled = LINES.filter((line) => coaLabels.includes(line.label) && !line.disabledAt).length;
    const qpEnabled = LINES.filter((line) => qpLabels.includes(line.label) && !line.disabledAt).length;
    let coaCount = 0;
    const coaStatements = await statementsOf(runner, async () => { coaCount = await tileCount(h, runner, { accounts: true }, 'coa_mismatch'); });
    assert.equal(coaCount, coaEnabled, 'the tile counts the lines outside the chart');
    assert.ok(coaStatements.some((sql) => sql.includes('coa_id <>')), 'that count reads the check');
    assert.ok(!coaStatements.some((sql) => /ec_accounts|spend_round_inputs|freeze_states/.test(sql)), 'and nothing of the quantity and price check');
    let qpCount = 0;
    const qpStatements = await statementsOf(runner, async () => { qpCount = await tileCount(h, runner); });
    assert.equal(qpCount, qpEnabled, 'the tile counts the lines to check for quantity and price');
    assert.ok(!qpStatements.some((sql) => sql.includes('coa_id <>')), 'that count reads nothing of the chart check');
    const both = await statementsOf(runner, () => h.budgetLines.summary({ ...ALL_LINES, shape: 'grid', limit: 100, sort: 'to_check:asc' }, access));
    assert.ok(both.some((sql) => sql.includes('coa_id <>') && sql.includes('ec_accounts')), 'a sort reads every check');

    const ctx = aiContext(runner, s, s.users.admin);
    const counted = await h.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'nature', filters: { to_check: ['coa_mismatch'] } });
    assert.equal(counted.total, coaEnabled, 'Kad counts the lines outside the chart as the tile');
    const kadListed = await h.queries.execute(ctx, { entity_type: 'budget_lines', filters: { to_check: ['coa_mismatch'] }, limit: 50 });
    assert.ok(kadListed.items.length > 0 && kadListed.items.every((item: any) => item.metadata.to_check?.includes('coa_mismatch')), 'Kad lists them, each naming its checks');
  });
  console.log('ok - to_check: each line names the checks it fails; a filter on one check keeps its lines and evaluates it alone');
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
    units: null,
    consolidation_account: { number: 2400, name: 'External services' },
    columns: [{ year: Y, measure: 'planned' }],
    unit_columns: [],
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
    assert.ok(registry.fields.to_check, `${who}: the field is in the registry`);
    assert.equal(registry.fields.entry_check, undefined, `${who}: the former field is gone`);
    const description = describeAiEntityFilters('budget_lines', registry);
    assert.ok(description.fields.some((field) => field.field === 'to_check'), `${who}: described`);
    const counted = await h.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'nature', filters: { to_check: ['quantity_price'] } });
    assert.equal(counted.total, await tileCount(h, runner, { accounts }), `${who}: aggregate_entities counts as the tile`);
    const listed = await h.queries.execute(ctx, { entity_type: 'budget_lines', filters: { to_check: ['quantity_price'] }, limit: 50 });
    assert.deepEqual(listed.items.map((item: any) => item.label.replace(/^Line /, '')).sort(), expected, `${who}: query_entities lists the tile's lines`);
    assert.ok(listed.items.every((item: any) => item.metadata.to_check?.includes('quantity_price')), `${who}: each line says it`);
    // One read of the rule for the detail: its row and `quantity_price_entry` share it.
    const manager: any = runner.manager;
    const query = manager.query;
    let reads = 0;
    manager.query = (sql: string, params?: unknown[]) => {
      if (/SELECT li\.id, ea\.level/.test(sql)) reads += 1;
      return query.call(manager, sql, params);
    };
    let detail: any;
    try {
      detail = await h.queries.executeDetail(ctx, { entity_type: 'budget_lines', entity_id: s.lines.cons.ref });
    } finally {
      manager.query = query;
    }
    assert.equal(reads, 1, `${who}: the detail reads the rule once`);
    assert.deepEqual(detail.data.to_check, ['quantity_price'], `${who}: the detail's row says it`);
  }
  console.log('ok - Kad and the MCP server: the field filters, counts as the tile, lists the same lines, shows in the detail');
}

/**
 * Kad's detail of a line says the fact in plain words (`quantity_price_entry`): who expects quantity
 * and price, each column to check by its name on screen and year with how it is entered today, and
 * that this is the whole cause of `to_check`; a conforming or unconcerned line says so. The column
 * names come in the person's language (a profile in French), or in the four languages without one;
 * never a storage key; no account number for a person who does not read the accounts.
 */
async function testKadDetailWords(h: Harness, runner: QueryRunner, s: Seed) {
  await runner.query(`UPDATE users SET locale = 'fr' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.users.admin]);
  const entryOf = async (userId: string, label: string) => {
    const detail = await h.queries.executeDetail(aiContext(runner, s, userId), { entity_type: 'budget_lines', entity_id: s.lines[label].ref });
    const entry = detail.data.quantity_price_entry as any;
    assert.doesNotMatch(JSON.stringify(entry), /"(planned|committed|forecast|actual|expected_landing|level|measure)"/, `${label}: no storage key`);
    return entry;
  };

  // The line's account expects it: two columns, each named in French, with how it is entered.
  const account = await entryOf(s.users.admin, 'multi');
  assert.equal(account.status, 'to_check', 'account: to check');
  assert.match(account.expected_by, /line's account 621100 - Temporary staff/, 'account: names the line\'s account');
  assert.deepEqual(account.columns_to_check.map((c: any) => c.column), [`Budget ${Y}`, `Réalisé ${Y + 2}`], 'account: the columns by their names on screen');
  assert.match(account.columns_to_check[0].entered_as, /spread over the months/, 'account: the budget is an amount spread');
  assert.match(account.columns_to_check[1].entered_as, /by month/, 'account: the actuals are entered by month');
  assert.match(account.explanation, /not built as quantity × price/, 'account: why');
  assert.match(account.explanation, /only cause/, 'account: the only cause');
  assert.match(account.explanation, /Nothing is refused/, 'account: nothing refused');
  assert.match(account.explanation, /Budget tab/, 'account: how to clear it');

  // The consolidation account expects it, named for a reader of the accounts.
  const consolidation = await entryOf(s.users.admin, 'cons');
  assert.equal(consolidation.status, 'to_check', 'consolidation: to check');
  assert.match(consolidation.expected_by, /consolidation account 2400 - External services/, 'consolidation: named');
  assert.match(consolidation.expected_by, /622100 - Fees/, 'consolidation: the line\'s account mapped to it');
  assert.deepEqual(consolidation.columns_to_check.map((c: any) => c.column), [`Budget ${Y}`], 'consolidation: the column');

  // The same line for a reader of budget without the accounts: no account number, the columns in four languages.
  const withheld = await entryOf(s.users.budgetOnly, 'cons');
  assert.equal(withheld.status, 'to_check', 'withheld: to check');
  assert.doesNotMatch(JSON.stringify(withheld), /2400|622100|External services|Fees/, 'withheld: no account named');
  assert.match(withheld.consolidation_account_withheld, /right on accounts/, 'withheld: says why it is not named');
  assert.deepEqual(withheld.columns_to_check[0].column, { en: `Budget ${Y}`, fr: `Budget ${Y}`, de: `Budget ${Y}`, es: `Presupuesto ${Y}` }, 'withheld: the four names without a profile language');

  // A conforming line and a line its account does not concern.
  const conforming = await entryOf(s.users.admin, 'qp');
  assert.equal(conforming.status, 'conforms', 'conforming: conforms');
  assert.equal(conforming.columns_to_check, undefined, 'conforming: no column to check');
  assert.match(conforming.explanation, /every column .* built as quantity × price/, 'conforming: says it');
  const unconcerned = await entryOf(s.users.admin, 'none');
  assert.equal(unconcerned.status, 'not_expected', 'unconcerned: not expected');
  assert.match(unconcerned.explanation, /expects no quantity and price entry/, 'unconcerned: says it');
  console.log('ok - Kad\'s detail: who expects it, the columns by name and how they are entered, the only cause; conforming and unconcerned lines');
}

/**
 * Kad and the MCP server name each check as the "To check" column does, in the person's language,
 * next to its code: `to_check_names` on a row, `key_name` on a group, `value_names` with the filter
 * values. The detail says why an account is outside the company's chart (`account_chart`): the two
 * charts by name for a reader of the accounts and the companies, the fact alone for the others. And
 * `describe_entity_filters` counts its fields under names that cannot read as a number of lines.
 */
async function testKadCheckNames(h: Harness, runner: QueryRunner, s: Seed) {
  await savepoint(runner, async () => {
    const chartId = async (prefix: string) => (await runner.query(`SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code LIKE $2`, [s.tenantId, `${prefix}-%`]))[0].id;
    const chartCode = async (prefix: string) => (await runner.query(`SELECT code FROM chart_of_accounts WHERE tenant_id = $1 AND code LIKE $2`, [s.tenantId, `${prefix}-%`]))[0].code;
    const companyOf = (label: string) => `(SELECT paying_company_id FROM spend_items WHERE tenant_id = $1 AND id = '${s.lines[label].id}')`;
    const aLine = LINES.find((line) => line.company === 'a' && line.account && !line.disabledAt)!;
    const qpLabels = toCheckLabels(truth());
    const bBoth = LINES.find((line) => line.company === 'b' && line.account && !line.disabledAt && qpLabels.includes(line.label))!;
    await runner.query(`UPDATE companies SET coa_id = $2 WHERE tenant_id = $1 AND id = ${companyOf(aLine.label)}`, [s.tenantId, await chartId('LOCAL')]);
    await runner.query(`UPDATE companies SET coa_id = $2 WHERE tenant_id = $1 AND id = ${companyOf(bBoth.label)}`, [s.tenantId, await chartId('OTHER')]);
    await runner.query(`UPDATE users SET locale = 'fr' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.users.admin]);
    await runner.query(`UPDATE users SET locale = NULL WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.users.budgetOnly]);
    const QP = 'Quantité et prix';
    const COA = 'Compte hors du plan de la société';
    const admin = aiContext(runner, s, s.users.admin);

    // A row: the codes for the filters, the names to quote.
    const listed = await h.queries.execute(admin, { entity_type: 'budget_lines', filters: { to_check: ['coa_mismatch'] }, limit: 50 });
    const both = listed.items.find((item: any) => item.label === `Line ${bBoth.label}`) as any;
    assert.deepEqual([both.metadata.to_check, both.metadata.to_check_names], [['quantity_price', 'coa_mismatch'], [QP, COA]], 'a row: the codes, and the names on screen in French');
    assert.ok(listed.items.every((item: any) => item.metadata.to_check_names.includes(COA)), 'every row listed names the check filtered on');
    const four = await h.queries.execute(aiContext(runner, s, s.users.budgetOnly), { entity_type: 'budget_lines', filters: { to_check: ['coa_mismatch'] }, limit: 1 });
    assert.deepEqual((four.items[0] as any).metadata.to_check_names.slice(-1),
      ['en: Account not in the company\'s chart; fr: Compte hors du plan de la société; de: Konto nicht im Kontenplan des Unternehmens; es: Cuenta fuera del plan de la empresa'],
      'no language in the profile: the four names');

    // A group, and a second group field.
    const grouped = await h.aggregates.execute(admin, { entity_type: 'budget_lines', group_by: 'to_check' });
    const byKey = new Map((grouped.groups as any[]).map((group) => [group.key, group]));
    assert.equal(byKey.get('quantity_price, coa_mismatch')?.key_name, `${QP}, ${COA}`, 'a group of both checks: both names');
    assert.equal(byKey.get('coa_mismatch')?.key_name, COA, 'a group of one check: its name');
    assert.equal(byKey.get(null)?.key_name, null, 'the lines that fail none: no name');
    const then = await h.aggregates.execute(admin, { entity_type: 'budget_lines', group_by: 'nature', then_by: 'to_check' } as any);
    assert.ok((then.groups as any[]).some((group) => group.then_key === 'coa_mismatch' && group.then_key_name === COA), 'a second group field: its name too');

    // The filter values.
    const values = await h.queries.executeFilterValues(admin, { entity_type: 'budget_lines', fields: ['to_check'] });
    assert.deepEqual(values.values.to_check, ['quantity_price', 'coa_mismatch', null], 'the codes to filter on');
    assert.deepEqual(values.value_names, { to_check: { quantity_price: QP, coa_mismatch: COA } }, 'their names on screen');

    // Why the account is outside the company's chart.
    const chartOf = async (userId: string, label: string) =>
      (await h.queries.executeDetail(aiContext(runner, s, userId), { entity_type: 'budget_lines', entity_id: s.lines[label].ref })).data.account_chart as any;
    const local = await chartCode('LOCAL');
    const other = await chartCode('OTHER');
    const outside = await chartOf(s.users.admin, bBoth.label);
    assert.equal(outside.status, 'to_check', 'outside: to check');
    assert.deepEqual([outside.account_chart, outside.paying_company_chart], [local, other], 'outside: both charts named');
    assert.match(outside.paying_company, /^Company B /, 'outside: the paying company named');
    assert.match(outside.explanation, new RegExp(`belongs to the chart of accounts ${local}, while its paying company Company B \\S+ uses the chart ${other}`), 'outside: the fact in words');
    assert.match(outside.explanation, /only cause of `coa_mismatch`/, 'outside: the only cause');
    const inside = await chartOf(s.users.admin, aLine.label);
    assert.equal(inside.status, 'conforms', 'inside: conforms');
    assert.match(inside.explanation, /the account is in the company's chart/, 'inside: says it');
    const noAccounts = await chartOf(s.users.budgetOnly, bBoth.label);
    assert.equal(noAccounts.status, 'to_check', 'without the right on accounts: still to check');
    assert.doesNotMatch(JSON.stringify(noAccounts), new RegExp(`${local}|${other}`), 'without the right on accounts: no chart named');
    assert.match(noAccounts.charts_withheld, /right on accounts/, 'without the right on accounts: says why');
    const noCompanies = await chartOf(s.users.budgetAndAccounts, bBoth.label);
    assert.deepEqual([noCompanies.account_chart, noCompanies.paying_company_chart], [local, undefined], 'without the right on companies: the account\'s chart only');
    assert.match(noCompanies.charts_withheld, /right on companies/, 'without the right on companies: says why');
  });
  console.log('ok - Kad names each check as the screen, in the person\'s language; says why an account is outside the company\'s chart');
}

/**
 * `describe_entity_filters` counts the fields it describes under names that say so: a model read its
 * bare `total` (82 fields) as a number of lines a limited person could read.
 */
async function testDescribeCountsFields(h: Harness, runner: QueryRunner, s: Seed) {
  const ctx = aiContext(runner, s, s.users.limited);
  const description: any = describeAiEntityFilters('budget_lines',
    await resolveAiEntityRegistry(ctx, 'budget_lines', (entityType: any) => h.policy.canReadEntityType(ctx, entityType, runner.manager)));
  assert.ok(description.fields.length > 0, 'fields described');
  assert.deepEqual([description.fields_total, description.fields_returned], [description.fields.length, description.fields.length], 'the number of fields described');
  assert.deepEqual([description.total, description.returned], [undefined, undefined], 'no bare total a model could read as lines');
  console.log('ok - describe_entity_filters counts its fields as fields');
}

async function testLimitedPerson(h: Harness, runner: QueryRunner, s: Seed) {
  if (!(await runner.query(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`))[0].present) {
    if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
    console.log('skip - kanap_data_limited not installed');
    return;
  }
  const companyA = toCheckLabels(truth()).filter((label) => s.lines[label].company === 'a');
  assert.ok(companyA.length > 0 && companyA.length < toCheckLabels(truth()).length, 'company A has some of the lines to check');
  const apply = async () => assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [s.users.limited]))[0].mode, 'limited');
  const none: Expect = { level: null, columns: [] };
  const ofA = (table: Map<string, Expect>) => Object.fromEntries([...table].filter(([label]) => s.lines[label].company === 'a'));
  // Each change is made with every row readable, then read by the person, then rolled back with
  // their access (a savepoint): the answers on company A are the truth table's, which the
  // administrator's reads match (`testParity`, `testChanges`), and company B reads as not expected.
  const changes: Array<[string, () => Promise<unknown>, Partial<Record<string, Expect>>]> = [
    ['as seeded', async () => undefined, {}],
    ['the forecast column on', () => runner.query(`UPDATE tenants SET metadata = metadata || '{"budget_columns":{"enabled":{"forecast":true}}}'::jsonb WHERE id = $1`, [s.tenantId]),
      { forecast: { level: 'account', columns: [[Y, 'forecast']] } }],
    ['no consolidation chart', () => runner.query(`UPDATE chart_of_accounts SET is_consolidation = false WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.consolidationChart]),
      { cons: none, consQp: none, consCapex: none }],
    ['the setting removed', () => runner.query(`UPDATE accounts SET quantity_price_expected = NULL WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.accounts.tick]),
      Object.fromEntries(LINES.filter((line) => line.account === 'tick').map((line) => [line.label, none]))],
    ['the column rebuilt as quantity and price', async () => {
      const round = s.rounds[`monthly:${Y}:planned`];
      await runner.query(`UPDATE spend_round_inputs SET method = 'computed' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, round]);
      await addLine(runner, s.tenantId, round, Y);
    }, { monthly: { level: 'account', columns: [] } }],
    ['the computed column given its lines', () => addLine(runner, s.tenantId, s.rounds[`computedNoLines:${Y}:planned`], Y),
      { computedNoLines: { level: 'account', columns: [] } }],
  ];
  for (const [what, change, edits] of changes) {
    await savepoint(runner, async () => {
      await change();
      await apply();
      assert.equal((await loadEntryCheckSettings(runner.manager, s.tenantId)).lineByLine, true, `${what}: limited, line by line`);
      const expected = truth(edits);
      const reader = await readerTable(runner, s);
      assert.deepEqual(ofA(reader), ofA(expected), `${what}: the reader on company A`);
      assert.ok([...reader].every(([label, e]) => s.lines[label].company === 'a' || (e.level === null && e.columns.length === 0)), `${what}: company B reads as not expected`);
      const field = await listField(h, runner, s);
      const fromTruth = Object.fromEntries(Object.entries(ofA(expected)).map(([label, e]) => [label, e.columns.length > 0 ? 'quantity_price' : null]));
      assert.deepEqual(Object.fromEntries(field), fromTruth, `${what}: the list's field on each line of company A`);
      const toCheck = toCheckLabels(new Map(Object.entries(ofA(expected))));
      assert.equal(await tileCount(h, runner), toCheck.filter((label) => !LINES.find((line) => line.label === label)!.disabledAt).length, `${what}: the tile`);
      const labels = labelOf(s);
      const filtered = await h.budgetLines.summary({ ...ALL_LINES, shape: 'grid', limit: 100, filters: JSON.stringify({ to_check: { filterType: 'set', values: ['quantity_price'] } }) },
        { manager: runner.manager, access: { accounts: true } });
      assert.deepEqual(filtered.items.map((item: any) => labels.get(item.id)).sort(), toCheck, `${what}: the filter`);
      const sorted = await h.budgetLines.summary({ ...ALL_LINES, shape: 'grid', limit: 100, sort: 'to_check:asc' }, { manager: runner.manager, access: { accounts: true } });
      assert.deepEqual(sorted.items.slice(0, toCheck.length).map((item: any) => labels.get(item.id)).sort(), toCheck, `${what}: the sort`);
      const values = await h.budgetLines.summaryFilterValues({ ...ALL_LINES, fields: 'to_check' }, { manager: runner.manager, access: { accounts: true } });
      assert.deepEqual(values.to_check, toCheck.length ? ['quantity_price', null] : [null], `${what}: the values`);
    });
  }
  await apply();
  const labels = labelOf(s);
  assert.equal(await tileCount(h, runner), companyA.length, 'the tile counts their lines only');
  const field = await listField(h, runner, s);
  assert.deepEqual([...field].filter(([, value]) => value === 'quantity_price').map(([label]) => label).sort(), companyA, 'the list');
  const checks = await readEntryChecks(runner.manager, s.tenantId, Object.values(s.lines).map((line) => line.id), { accounts: true });
  assert.deepEqual([...checks].filter(([, check]) => check.to_check).map(([id]) => labels.get(id)).sort(), companyA, 'the reader reads their lines only');
  const reader = routeContext(runner, { budget: 'reader', accounts: 'reader' });
  assert.equal((await h.controller.entryCheck(s.lines.monthly.ref, reader)).to_check, true, 'the route on a line of company A');
  await assert.rejects(h.controller.entryCheck(s.lines.spread.ref, reader), (error: any) => error?.status === 404, 'a line of company B is 404, as a missing one');
  const ctx = aiContext(runner, s, s.users.limited);
  const counted = await h.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'nature', filters: { to_check: ['quantity_price'] } });
  assert.equal(counted.total, companyA.length, 'Kad counts their lines only');
  assert.equal(counted.data_access, 'limited', 'said within their access');
  console.log('ok - a person limited to one company reads, counts and lists the lines of that company only, as with every row readable');
}

/**
 * The rule before a write, against the reader once the write is made: the level of each
 * account (Kad's cards, the budget file's catalog), and the columns each line would have to check
 * on an expected account, read where it stands, then read again once every line is on that account.
 */
async function testBeforeWrite(h: Harness, runner: QueryRunner, s: Seed) {
  const levels = await readAccountExpectations(runner.manager, s.tenantId);
  const byKey = Object.fromEntries(Object.entries(s.accounts).map(([key, id]) => [key, levels.get(id)?.level ?? null]));
  assert.ok([...levels.values()].every((expectation) => expectation.units === null), 'no account here names units: any unit');
  assert.deepEqual(byKey, { tick: 'account', cons: 'consolidation', both: 'account', none: null, noCons: null, outside: null, otherChart: null },
    'the accounts that expect it, at their level');
  const reader = await readerTable(runner, s);
  for (const line of LINES) {
    if (!line.account) continue;
    assert.equal(levels.get(s.accounts[line.account])?.level ?? null, reader.get(line.label)!.level, `${line.label}: the account's level is the line's`);
  }
  const some = await readAccountExpectations(runner.manager, s.tenantId, [s.accounts.cons, s.accounts.none]);
  assert.deepEqual([...some], [[s.accounts.cons, { level: 'consolidation', units: null }]], 'asked for some accounts: those that expect it');
  assert.equal((await readAccountExpectations(runner.manager, s.tenantId, [])).size, 0, 'none asked: none');

  const catalog = await loadCatalog(runner.manager, s.tenantId, null);
  const flagged = catalog.accounts.filter((account) => account.quantityPrice).map((account) => account.id).sort();
  assert.deepEqual(flagged, [...levels.keys()].sort(), 'the budget file\'s catalog flags the same accounts');
  assert.deepEqual(catalog.shownMeasures, ['planned', 'committed', 'actual', 'expected_landing'], 'the columns shown (forecast off)');

  const ids = Object.values(s.lines).map((line) => line.id);
  const before = await readColumnsToCheckOnAnyAccount(runner.manager, s.tenantId, ids);
  await savepoint(runner, async () => {
    await runner.query(`UPDATE spend_items SET account_id = $2 WHERE tenant_id = $1`, [s.tenantId, s.accounts.tick]);
    const after = await readEntryChecks(runner.manager, s.tenantId, ids);
    const labels = labelOf(s);
    const shape = (columns: Array<{ year: number; measure: string }> | undefined) => (columns ?? []).map((c) => `${c.year}:${c.measure}`);
    assert.deepEqual(
      Object.fromEntries(ids.map((id) => [labels.get(id), shape(before.get(id))])),
      Object.fromEntries(ids.map((id) => [labels.get(id), shape(after.get(id)!.columns)])),
      'the columns read before the move are the reader\'s once every line is on the account',
    );
  });
  console.log('ok - before a write: the accounts that expect it and the columns a move leaves to check, as the reader says once written');
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
      await testToCheckField(h, runner, s);
      await testChanges(h, runner, s);
      await testRoute(h, runner, s);
      await testKad(h, runner, s);
      await testKadDetailWords(h, runner, s);
      await testKadCheckNames(h, runner, s);
      await testDescribeCountsFields(h, runner, s);
      await testBeforeWrite(h, runner, s);
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
