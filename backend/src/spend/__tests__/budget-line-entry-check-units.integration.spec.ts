import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { MEASURE_FREEZE_COLUMN } from '../amounts-write.util';
import { loadEntryCheckSettings, readEntryChecks } from '../budget-line-entry-check';

// The units an account expects in the quantity and price check, against the
// database, on seeded tenants in rolled-back transactions. A column of a line whose level (the
// line's account when it sets the check, else its consolidation account, as a block) names units
// conforms when it is built as quantity × price with at least one calculation line in one of them.
// - every reader of the rule agrees with a written truth table: the per-line reader (its units, its
//   columns to check and those that lack only a unit), the list's `to_check` field, its filter, the
//   rows the list draws, the hygiene tile's count, the line's route, Kad's count, list and detail;
// - the five tests of the acceptance sheet: an account on people and days with a column in pieces
//   only (to check) then given a line in days (conforms); a line on an account on pieces (its unit
//   comes first, `units`); an account set without units (pieces conform); a consolidation account on
//   people and days applied to the accounts mapped to it;
// - the block: an account that sets the check without units under a consolidation account that
//   names some checks the mode alone; one that names its own units reads its own;
// - a frozen column never warns; another tenant's settings change nothing;
// - a person limited to one company reads, counts and lists the lines of that company only, with
//   the same answers.
// @database-spec: boots the application context, so run-ci-tests.js runs this file in a database lane.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.SETTINGS_ENCRYPTION_SECRET ||= process.env.AI_SETTINGS_ENCRYPTION_SECRET || 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'budget-line-entry-check-units-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const Y = new Date().getFullYear();

type Harness = { app: any; dataSource: DataSource; aggregates: any; queries: any; budgetLines: any; controller: any };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for budget-line-entry-check-units.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../../ai/query/ai-query.executor');
  const { AiAggregateExecutor } = require('../../ai/query/ai-aggregate.executor');
  const { BudgetLinesService } = require('../budget-lines.service');
  const { BudgetLinesController } = require('../budget-lines.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return {
    app,
    dataSource: app.get(DataSource),
    aggregates: app.get(AiAggregateExecutor),
    queries: app.get(AiQueryExecutor),
    budgetLines: app.get(BudgetLinesService),
    controller: app.get(BudgetLinesController),
  };
}

type Unit = 'people' | 'days' | 'pieces';
type AccountKey = 'ppl' | 'pcs' | 'mode' | 'underCons' | 'underConsMode' | 'underConsOwn';
/** A column of the line: `units` the units of its calculation lines (computed), or a spread amount. */
type Column = { year: number; units: Unit[] | 'spread' };
type LineDef = { label: string; account: AccountKey; company: 'a' | 'b'; column: Column };
/** What the rule says of a line: its level and units, whether its column is to check, and whether only its units are wrong. */
type Expect = { level: 'account' | 'consolidation'; units: Unit[] | null; toCheck: boolean; unitsOnly: boolean };

const computed = (...units: Unit[]): Column => ({ year: Y, units });

const ACCOUNTS: Record<AccountKey, { number: number; expected: boolean; units: Unit[] | null; consolidation: number | null }> = {
  ppl: { number: 621100, expected: true, units: ['people', 'days'], consolidation: null },
  pcs: { number: 641000, expected: true, units: ['pieces'], consolidation: null },
  mode: { number: 651000, expected: true, units: null, consolidation: null },
  underCons: { number: 622100, expected: false, units: null, consolidation: 2400 },
  underConsMode: { number: 622200, expected: true, units: null, consolidation: 2400 },
  underConsOwn: { number: 622300, expected: true, units: ['pieces'], consolidation: 2400 },
};

const LINES: Array<LineDef & { expect: Expect }> = [
  // Test 2: people and days expected, the column in pieces only; a line in people next to pieces conforms (the limit).
  { label: 'pplPieces', account: 'ppl', company: 'a', column: computed('pieces'), expect: { level: 'account', units: ['people', 'days'], toCheck: true, unitsOnly: true } },
  { label: 'pplMixed', account: 'ppl', company: 'b', column: computed('pieces', 'people'), expect: { level: 'account', units: ['people', 'days'], toCheck: false, unitsOnly: false } },
  { label: 'pplDays', account: 'ppl', company: 'a', column: computed('days'), expect: { level: 'account', units: ['people', 'days'], toCheck: false, unitsOnly: false } },
  { label: 'pplSpread', account: 'ppl', company: 'b', column: { year: Y, units: 'spread' }, expect: { level: 'account', units: ['people', 'days'], toCheck: true, unitsOnly: false } },
  // A frozen column (OPEX budget of Y+1) never warns.
  { label: 'pplFrozen', account: 'ppl', company: 'a', column: { year: Y + 1, units: ['pieces'] }, expect: { level: 'account', units: ['people', 'days'], toCheck: false, unitsOnly: false } },
  // Test 3: an account on pieces (its first unit opens a new calculation line).
  { label: 'pcsPeople', account: 'pcs', company: 'a', column: computed('people'), expect: { level: 'account', units: ['pieces'], toCheck: true, unitsOnly: true } },
  // Test 4: set without units, a column in pieces conforms.
  { label: 'modePieces', account: 'mode', company: 'b', column: computed('pieces'), expect: { level: 'account', units: null, toCheck: false, unitsOnly: false } },
  // Test 5: the consolidation account on people and days, the account mapped to it set nothing.
  { label: 'consPieces', account: 'underCons', company: 'a', column: computed('pieces'), expect: { level: 'consolidation', units: ['people', 'days'], toCheck: true, unitsOnly: true } },
  { label: 'consPeople', account: 'underCons', company: 'b', column: computed('people'), expect: { level: 'consolidation', units: ['people', 'days'], toCheck: false, unitsOnly: false } },
  // The block: an account set without units under it checks the mode alone; one with its own units reads them.
  { label: 'consModePieces', account: 'underConsMode', company: 'a', column: computed('pieces'), expect: { level: 'account', units: null, toCheck: false, unitsOnly: false } },
  { label: 'consOwnPeople', account: 'underConsOwn', company: 'b', column: computed('people'), expect: { level: 'account', units: ['pieces'], toCheck: true, unitsOnly: true } },
  { label: 'consOwnPieces', account: 'underConsOwn', company: 'a', column: computed('pieces'), expect: { level: 'account', units: ['pieces'], toCheck: false, unitsOnly: false } },
];

type Seed = {
  tenantId: string;
  users: { admin: string; limited: string };
  accounts: Record<AccountKey, string>;
  consolidationAccount: string;
  lines: Record<string, { id: string; ref: string; company: 'a' | 'b'; round: string | null }>;
  profile: string;
};

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function addLine(runner: QueryRunner, tenantId: string, roundId: string, sort: number, unit: Unit, profile: string) {
  const basis = { people: ['per_month', 'per_month', null], days: ['per_day', 'once', profile], pieces: ['per_piece', 'once', null] }[unit];
  await runner.query(
    `INSERT INTO spend_round_input_lines (tenant_id, round_input_id, sort, label, quantity_unit, quantity, unit_price, price_basis, frequency, working_day_profile_id, period_start, period_end)
     VALUES ($1, $2, $3, 'Line', $4, 1, 100, $5, $6, $7, make_date($8, 1, 1), make_date($8, 12, 31))`,
    [tenantId, roundId, sort, unit, basis[0], basis[1], basis[2], Y],
  );
}

/** A tenant with the accounts and lines above; `consolidationUnits` the units of its consolidation account 2400. */
async function seed(runner: QueryRunner, consolidationUnits: Unit[] | null = ['people', 'days']): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `entry-units-${tag}`, `Entry units ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const role = async (name: string, rights: string[]) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, $2, 'units spec', false, false)`, [tenantId, name]);
    for (const resource of rights) await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'reader')`, [tenantId, id, resource]);
    return id;
  };
  const user = async (roleId: string, mode: 'all' | 'limited') => {
    const id = randomUUID();
    await runner.query(
      `INSERT INTO users (id, tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, data_access_mode, locale)
       VALUES ($1, $2, 'Units', 'Check', $3, $4, false, 'enabled', $5, 'fr')`,
      [id, tenantId, `entry-units-${id.slice(0, 8)}@example.test`, roleId, mode],
    );
    return id;
  };
  const companies = {
    a: await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Brest', 'enabled')`, [tenantId, `Company A ${tag}`]),
    b: await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Quimper', 'enabled')`, [tenantId, `Company B ${tag}`]),
  };
  const budgetAndAccounts = await role('Budget and accounts', ['budget', 'accounts']);
  const users = { admin: await user(await role('Administrator', []), 'all'), limited: await user(budgetAndAccounts, 'limited') };
  await runner.query(`INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access) VALUES ($1, $2, 'company', $3, 'read')`, [tenantId, users.limited, companies.a]);
  const profile = await insertId(runner, `INSERT INTO working_day_profiles (tenant_id, code, name) VALUES ($1, 'STD', 'Standard')`, [tenantId]);

  const chart = (code: string) => insertId(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, scope) VALUES ($1, $2, $2, 'GLOBAL')`, [tenantId, `${code}-${tag}`]);
  const local = await chart('LOCAL');
  const ifrs = await chart('IFRS');
  await runner.query(`UPDATE chart_of_accounts SET is_consolidation = true WHERE tenant_id = $1 AND id = $2`, [tenantId, ifrs]);
  const account = (coa: string, number: number, expected: boolean, units: Unit[] | null, consolidation: number | null) => insertId(runner,
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, quantity_price_expected, expected_units, consolidation_account_number)
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7)`,
    [tenantId, coa, number, `Account ${number}`, expected ? true : null, units, consolidation]);
  const consolidationAccount = await account(ifrs, 2400, consolidationUnits !== undefined, consolidationUnits, null);
  const accounts = {} as Record<AccountKey, string>;
  for (const [key, def] of Object.entries(ACCOUNTS) as Array<[AccountKey, typeof ACCOUNTS[AccountKey]]>) {
    accounts[key] = await account(local, def.number, def.expected, def.units, def.consolidation);
  }
  await runner.query(`INSERT INTO freeze_states (tenant_id, budget_year, scope, column_key, is_frozen) VALUES ($1, $2, 'opex', $3, true)`, [tenantId, Y + 1, MEASURE_FREEZE_COLUMN.planned]);

  const lines: Seed['lines'] = {};
  for (const [index, line] of LINES.entries()) {
    const itemNumber = index + 1;
    const id = await insertId(runner,
      `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, paying_company_id, account_id)
       VALUES ($1, 'opex', $2, $3, 'EUR', $4::date, 'enabled', $5, $6)`,
      [tenantId, itemNumber, `Line ${line.label}`, `${Y - 1}-01-01`, companies[line.company], accounts[line.account]]);
    const version = await insertId(runner,
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year) VALUES ($1, $2, $3, $4::date, $5)`,
      [tenantId, id, `V${line.column.year}`, `${line.column.year}-01-01`, line.column.year]);
    await runner.query(`INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, make_date($3, 1, 1), 1200)`, [tenantId, version, line.column.year]);
    const method = line.column.units === 'spread' ? 'spread' : 'computed';
    const round = await insertId(runner,
      `INSERT INTO spend_round_inputs (tenant_id, version_id, measure, period_start, period_end, method)
       VALUES ($1, $2, 'planned', make_date($3, 1, 1), make_date($3, 12, 31), $4)`,
      [tenantId, version, line.column.year, method]);
    if (line.column.units !== 'spread') {
      for (const [sort, unit] of line.column.units.entries()) await addLine(runner, tenantId, round, sort + 1, unit, profile);
    }
    lines[line.label] = { id, ref: `BL-${itemNumber}`, company: line.company, round };
  }
  return { tenantId, users, accounts, consolidationAccount, lines, profile };
}

// ----- reads -----

function truth(changes: Partial<Record<string, Partial<Expect>>> = {}): Map<string, Expect> {
  return new Map(LINES.map((line) => [line.label, { ...line.expect, ...changes[line.label] }]));
}

const labelOf = (s: Seed) => new Map(Object.entries(s.lines).map(([label, line]) => [line.id, label]));
const ALL_LINES = { includeDisabled: true };
const toCheckLabels = (table: Map<string, Expect>) => [...table].filter(([, e]) => e.toCheck).map(([label]) => label).sort();

/** What the per-line reader says, in the truth table's shape (each line has one column, `planned` of its year). */
async function readerTable(runner: QueryRunner, s: Seed): Promise<Map<string, Expect | null>> {
  const checks = await readEntryChecks(runner.manager, s.tenantId, Object.values(s.lines).map((line) => line.id), { accounts: true });
  const labels = labelOf(s);
  return new Map([...checks].map(([id, check]) => {
    if (!check.expected) return [labels.get(id)!, null];
    const line = LINES.find((entry) => entry.label === labels.get(id))!;
    const column = [{ year: line.column.year, measure: 'planned' }];
    assert.deepEqual(check.columns, check.to_check ? column : [], `${line.label}: its column`);
    assert.ok(check.unit_columns.every((c) => check.columns.some((d) => d.year === c.year && d.measure === c.measure)), `${line.label}: unit columns among its columns`);
    return [line.label, { level: check.level!, units: check.units as Unit[] | null, toCheck: check.to_check, unitsOnly: check.unit_columns.length > 0 }];
  }));
}

async function listField(h: Harness, runner: QueryRunner, s: Seed): Promise<Map<string, string | null>> {
  const result = await h.budgetLines.summaryAggregate(ALL_LINES, { groupBy: ['id', 'to_check'], measures: [] }, { manager: runner.manager, access: { accounts: true } });
  const labels = labelOf(s);
  return new Map(result.groups.map((group: any) => [labels.get(group.keys[0])!, group.keys[1] ?? null]));
}

async function tileCount(h: Harness, runner: QueryRunner): Promise<number> {
  const result = await h.budgetLines.summaryAggregate(
    { filters: { to_check: { filterType: 'set', values: ['quantity_price'] } }, status: 'enabled' },
    { groupBy: [], measures: [] },
    { manager: runner.manager, access: { accounts: true } },
  );
  return result.total.count;
}

function aiContext(runner: QueryRunner, s: Seed, userId: string) {
  return { tenantId: s.tenantId, userId, isPlatformHost: false, surface: 'mcp' as const, authMethod: 'api_key' as const, manager: runner.manager };
}

/** Every reader against the truth table, for the lines `only` keeps (every line by default). */
async function assertAgree(h: Harness, runner: QueryRunner, s: Seed, expected: Map<string, Expect>, what: string, only: (label: string) => boolean = () => true, userId = s.users.admin) {
  const kept = new Map([...expected].filter(([label]) => only(label)));
  const reader = await readerTable(runner, s);
  assert.deepEqual(Object.fromEntries([...reader].filter(([label]) => only(label))), Object.fromEntries(kept), `${what}: the reader follows the truth table`);
  assert.ok([...reader].every(([label, e]) => only(label) || e === null), `${what}: the lines out of reach read as not expected`);
  const field = await listField(h, runner, s);
  assert.deepEqual(Object.fromEntries(field), Object.fromEntries([...kept].map(([label, e]) => [label, e.toCheck ? 'quantity_price' : null])), `${what}: the list's field`);
  const labels = labelOf(s);
  const filtered = await h.budgetLines.summary({ ...ALL_LINES, shape: 'grid', limit: 100, filters: JSON.stringify({ to_check: { filterType: 'set', values: ['quantity_price'] } }) },
    { manager: runner.manager, access: { accounts: true } });
  assert.deepEqual(filtered.items.map((item: any) => labels.get(item.id)).sort(), toCheckLabels(kept), `${what}: the list's filter`);
  assert.equal(await tileCount(h, runner), toCheckLabels(kept).length, `${what}: the tile's count`);
  const rows = await h.budgetLines.summaryRowsByIds([...kept.keys()].map((label) => s.lines[label].id), { years: [Y, Y + 1] }, { manager: runner.manager });
  assert.deepEqual(Object.fromEntries(rows.map((row: any) => [labels.get(row.id), row.to_check])),
    Object.fromEntries([...kept].map(([label, e]) => [label, e.toCheck ? ['quantity_price'] : null])), `${what}: the rows the list draws`);
  const ctx = aiContext(runner, s, userId);
  const counted = await h.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'nature', filters: { to_check: ['quantity_price'] } });
  assert.equal(counted.total, toCheckLabels(kept).length, `${what}: Kad counts as the tile`);
  const listed = await h.queries.execute(ctx, { entity_type: 'budget_lines', filters: { to_check: ['quantity_price'] }, limit: 50 });
  assert.deepEqual(listed.items.map((item: any) => item.label.replace(/^Line /, '')).sort(), toCheckLabels(kept), `${what}: Kad lists the same lines`);
}

async function savepoint(runner: QueryRunner, fn: () => Promise<void>) {
  await runner.query('SAVEPOINT entry_units');
  try {
    await fn();
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT entry_units');
  }
}

// ----- tests -----

async function testParity(h: Harness, runner: QueryRunner, s: Seed) {
  assert.equal((await loadEntryCheckSettings(runner.manager, s.tenantId)).lineByLine, false, 'every row readable');
  await assertAgree(h, runner, s, truth(), 'as seeded');
  console.log('ok - the reader, the list, its filter, its rows, the tile and Kad follow the units, both levels as a block, a frozen column left out');
}

async function testChanges(h: Harness, runner: QueryRunner, s: Seed) {
  // Test 2, second step: a line in days next to pieces clears it.
  await savepoint(runner, async () => {
    await addLine(runner, s.tenantId, s.lines.pplPieces.round!, 9, 'days', s.profile);
    await assertAgree(h, runner, s, truth({ pplPieces: { toCheck: false, unitsOnly: false } }), 'a line in days added');
  });
  // The units removed from the account: the mode alone.
  await savepoint(runner, async () => {
    await runner.query(`UPDATE accounts SET expected_units = NULL WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.accounts.ppl]);
    const off = { units: null, toCheck: false, unitsOnly: false };
    await assertAgree(h, runner, s, truth({
      pplPieces: off, pplMixed: { units: null }, pplDays: { units: null }, pplFrozen: { units: null }, pplSpread: { units: null, toCheck: true },
    }), 'the units removed from the account');
  });
  // The consolidation account's units removed: its accounts check the mode alone.
  await savepoint(runner, async () => {
    await runner.query(`UPDATE accounts SET expected_units = NULL WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.consolidationAccount]);
    await assertAgree(h, runner, s, truth({ consPieces: { units: null, toCheck: false, unitsOnly: false }, consPeople: { units: null } }), 'the consolidation account\'s units removed');
  });
  // The column unfrozen: its line in pieces is to check against people and days.
  await savepoint(runner, async () => {
    await runner.query(`UPDATE freeze_states SET is_frozen = false WHERE tenant_id = $1`, [s.tenantId]);
    await assertAgree(h, runner, s, truth({ pplFrozen: { toCheck: true, unitsOnly: true } }), 'the column unfrozen');
  });
  console.log('ok - a line in an expected unit added, the units removed (account, consolidation account), the column unfrozen');
}

async function testRoute(h: Harness, runner: QueryRunner, s: Seed) {
  const reader = { manager: runner.manager, isAdmin: false, permissions: { budget: 'reader', accounts: 'reader' } };
  assert.deepEqual(await h.controller.entryCheck(s.lines.pplPieces.ref, reader), {
    id: s.lines.pplPieces.id,
    reference: s.lines.pplPieces.ref,
    expected: true,
    level: 'account',
    units: ['people', 'days'],
    consolidation_account: null,
    columns: [{ year: Y, measure: 'planned' }],
    unit_columns: [{ year: Y, measure: 'planned' }],
    to_check: true,
  }, 'the route: the units, the column that lacks only a unit');
  const spread = await h.controller.entryCheck(s.lines.pplSpread.ref, reader);
  assert.deepEqual([spread.columns.length, spread.unit_columns], [1, []], 'a column not built as quantity and price lacks the mode');
  const pieces = await h.controller.entryCheck(s.lines.pcsPeople.ref, reader);
  assert.deepEqual(pieces.units, ['pieces'], 'test 3: the account on pieces gives its unit to the line');
  const cons = await h.controller.entryCheck(s.lines.consPieces.ref, reader);
  assert.deepEqual([cons.level, cons.units, cons.consolidation_account, cons.unit_columns.length], ['consolidation', ['people', 'days'], { number: 2400, name: 'Account 2400' }, 1],
    'test 5: the consolidation account\'s units');
  const budgetOnly = await h.controller.entryCheck(s.lines.consPieces.ref, { ...reader, permissions: { budget: 'reader' } });
  assert.deepEqual([budgetOnly.units, budgetOnly.consolidation_account], [['people', 'days'], null], 'without the accounts: the units, never the account');
  console.log('ok - the route: units, columns to check and those that lack only a unit, for a reader with and without the accounts');
}

async function testKadDetail(h: Harness, runner: QueryRunner, s: Seed) {
  const entryOf = async (label: string) => (await h.queries.executeDetail(aiContext(runner, s, s.users.admin), { entity_type: 'budget_lines', entity_id: s.lines[label].ref })).data.quantity_price_entry as any;
  const units = await entryOf('pplPieces');
  assert.equal(units.status, 'to_check');
  assert.equal(units.expected_units, 'personnes ou jours', 'the units by their names, in the person\'s language');
  assert.match(units.columns_to_check[0].entered_as, /quantity and price, with no calculation line in personnes ou jours/, 'the column lacks only a unit');
  assert.match(units.explanation, /with at least one calculation line in personnes ou jours/, 'what is expected');
  const mode = await entryOf('pplSpread');
  assert.match(mode.columns_to_check[0].entered_as, /spread over the months/, 'a column not built so lacks the mode');
  const conforms = await entryOf('pplMixed');
  assert.equal(conforms.status, 'conforms');
  assert.match(conforms.explanation, /personnes ou jours/, 'a conforming line names the units too');
  const none = await entryOf('modePieces');
  assert.equal(none.expected_units, undefined, 'an account without units names none');
  for (const entry of [units, mode, conforms, none]) {
    assert.doesNotMatch(JSON.stringify(entry), /\b(people|days|pieces)\b/, 'never a unit code');
  }
  console.log('ok - Kad\'s detail names the expected units in the person\'s language and says which column lacks only a unit');
}

async function testOtherTenant(h: Harness, runner: QueryRunner, s: Seed) {
  await savepoint(runner, async () => {
    // Another tenant whose consolidation account 2400 and account 621100 name pieces.
    const other = await seed(runner, ['pieces']);
    await runner.query(`UPDATE accounts SET expected_units = ARRAY['pieces'] WHERE tenant_id = $1 AND account_number = 621100`, [other.tenantId]);
    const otherConsPieces = await readEntryChecks(runner.manager, other.tenantId, [other.lines.consPieces.id, other.lines.pplPieces.id]);
    assert.deepEqual([otherConsPieces.get(other.lines.consPieces.id)!.to_check, otherConsPieces.get(other.lines.pplPieces.id)!.to_check], [false, false], 'the other tenant reads its own units');
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    await assertAgree(h, runner, s, truth(), 'with another tenant set otherwise');
  });
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
  console.log('ok - another tenant\'s units change nothing');
}

async function testLimitedPerson(h: Harness, runner: QueryRunner, s: Seed) {
  if (!(await runner.query(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`))[0].present) {
    if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
    console.log('skip - kanap_data_limited not installed');
    return;
  }
  const ofA = (label: string) => s.lines[label].company === 'a';
  const changes: Array<[string, () => Promise<unknown>, Partial<Record<string, Partial<Expect>>>]> = [
    ['as seeded', async () => undefined, {}],
    ['a line in days added', () => addLine(runner, s.tenantId, s.lines.pplPieces.round!, 9, 'days', s.profile), { pplPieces: { toCheck: false, unitsOnly: false } }],
    ['the consolidation account\'s units removed', () => runner.query(`UPDATE accounts SET expected_units = NULL WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.consolidationAccount]),
      { consPieces: { units: null, toCheck: false, unitsOnly: false }, consPeople: { units: null } }],
  ];
  for (const [what, change, edits] of changes) {
    await savepoint(runner, async () => {
      await change();
      assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [s.users.limited]))[0].mode, 'limited');
      assert.equal((await loadEntryCheckSettings(runner.manager, s.tenantId)).lineByLine, true, `${what}: line by line`);
      await assertAgree(h, runner, s, truth(edits), `limited, ${what}`, ofA, s.users.limited);
    });
  }
  console.log('ok - a person limited to one company reads, counts and lists the lines of that company only, with the same answers');
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
  const h = await createHarness();
  try {
    await inTransaction(h, async (runner, s) => {
      await testParity(h, runner, s);
      await testChanges(h, runner, s);
      await testRoute(h, runner, s);
      await testKadDetail(h, runner, s);
      await testOtherTenant(h, runner, s);
    });
    // `data_access_apply` limits the rest of its transaction: a transaction of its own.
    await inTransaction(h, (runner, s) => testLimitedPerson(h, runner, s));
  } finally {
    await h.app.close();
  }
  console.log('budget-line-entry-check-units.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
