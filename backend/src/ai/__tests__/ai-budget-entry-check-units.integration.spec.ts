import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { readEntryChecks } from '../../spend/budget-line-entry-check';

// The paths that count or warn of the lines a write leaves "To check" (change in bulk, budget file,
// Kad's cards, copy of columns) follow the units an account expects (`accounts.expected_units`). An
// account on people and days: a column built as quantity × price in pieces only is to check, one with
// a calculation line in days is not. Each case is read back with `readEntryChecks` (or the list's own
// field) once written.
// - The change in bulk of the screen counts the rows it leaves to check; the two levels as a block: an
//   account mapped to a consolidation account on people and days takes its units, an account that sets
//   the entry without units checks the mode alone.
// - Kad's card in bulk: the count, the warning with the units, a limited person's own lines only.
// - Kad's cards of one line: a move onto the account says the unit problem with the Budget tab's words
//   when only a unit lacks, the entry mode with the units otherwise; a total written says the units too.
// - The budget file: its warning says the problem, the mode with the units or the units alone, and the
//   load leaves to check exactly what it said.
// - "Copy budget columns": a column copied with its lines in pieces is counted, one with a line in
//   people is not.
// @database-spec: boots the application context, so run-ci-tests.js runs this file in a database lane.

process.env.AI_CHAT_ENABLED = 'true';
process.env.AI_SETTINGS_ENABLED = 'true';
process.env.AI_MCP_ENABLED = 'true';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const Y = new Date().getFullYear();
const WARNING_FIELD = 'entry_check_warning';
const PPL = '621100 - Temporary staff';
const UNITS_WARNING = (account: string) =>
  `The account ${account} expects calculation lines in people or days: the columns built without one will be to check, to complete on the Budget tab of the line.`;
const ACCOUNT_WARNING = `The account ${PPL} expects quantity and price entry, with calculation lines in people or days: the amounts not entered that way will be to check, to complete on the Budget tab of the line.`;
const AMOUNTS_WARNING = `The account ${PPL} expects quantity and price entry, with calculation lines in people or days, and Kad only writes a total: this amount will be to check, to complete on the line's Budget tab.`;

type Unit = 'people' | 'days' | 'pieces';
type AccountKey = 'ppl' | 'none' | 'under' | 'modeOnly';
type Column = { measure: 'planned' | 'forecast'; units: Unit[] | 'spread' };
type LineDef = { n: number; account: AccountKey; company: 'a' | 'b'; columns: Column[] };
type Harness = { app: any; dataSource: DataSource; tools: any; previews: any; budgetLines: any };
type Seed = {
  tenantId: string;
  users: { member: string; limited: string };
  companies: { a: string; b: string };
  accounts: Record<AccountKey, string>;
  lines: Record<number, string>;
  conversations: Record<string, string>;
};

/**
 * 1, 3: a Budget in pieces only, on an account that expects nothing (3 paid by company B). 2: in
 * pieces and days. 5: a spread Budget. 4, 7: on the account on people and days, a Budget in days and
 * a hidden Forecast in pieces (4) or in pieces and people (7). 6: a Budget in pieces on an account that
 * sets the entry without units, mapped to the consolidation account on people and days.
 */
const LINES: LineDef[] = [
  { n: 1, account: 'none', company: 'a', columns: [{ measure: 'planned', units: ['pieces'] }] },
  { n: 2, account: 'none', company: 'a', columns: [{ measure: 'planned', units: ['pieces', 'days'] }] },
  { n: 3, account: 'none', company: 'b', columns: [{ measure: 'planned', units: ['pieces'] }] },
  { n: 4, account: 'ppl', company: 'a', columns: [{ measure: 'planned', units: ['days'] }, { measure: 'forecast', units: ['pieces'] }] },
  { n: 5, account: 'none', company: 'a', columns: [{ measure: 'planned', units: 'spread' }] },
  { n: 6, account: 'modeOnly', company: 'a', columns: [{ measure: 'planned', units: ['pieces'] }] },
  { n: 7, account: 'ppl', company: 'a', columns: [{ measure: 'planned', units: ['days'] }, { measure: 'forecast', units: ['pieces', 'people'] }] },
];

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return String((await runner.query(sql, params))[0].id);
}

async function seedGraph(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `entry-units-${tag}`, `Entry units ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const model = await one(runner,
    `INSERT INTO ai_model_configs (tenant_id, name, provider, model, endpoint_url, api_key_encrypted, supports_vision, is_default, created_at, updated_at)
     VALUES ($1, 'units-model', 'custom', 'units-model', 'https://llm.example.test/v1', 'test-secret', true, true, now(), now()) RETURNING id`, [tenantId]);
  await runner.query(
    `INSERT INTO ai_settings (tenant_id, chat_enabled, mcp_enabled, provider_source, llm_provider, llm_endpoint_url, llm_model,
                              llm_api_key_encrypted, web_search_enabled, glpi_enabled, chat_model_config_id, created_at, updated_at)
     VALUES ($1, true, true, 'custom', 'custom', 'https://llm.example.test/v1', 'units-model', 'test-secret', false, false, $2, now(), now())`,
    [tenantId, model]);
  const roleId = await one(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Budget member', 'units spec', false, false, now(), now()) RETURNING id`, [tenantId]);
  for (const [resource, level] of [['ai_chat', 'member'], ['budget', 'member']]) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())`,
      [tenantId, roleId, resource, level]);
  }
  const user = (first: string, mode: 'all' | 'limited') => one(runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, locale, data_access_mode, created_at, updated_at)
     VALUES ($1, $2, 'Tester', $3, $4, false, 'enabled', 'en', $5, now(), now()) RETURNING id`,
    [tenantId, first, `${first.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`, roleId, mode]);
  const users = { member: await user('Member', 'all'), limited: await user('Limited', 'limited') };

  const local = await one(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, $2, 'Local', 'FR') RETURNING id`, [tenantId, `L${tag}`]);
  const ifrs = await one(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, scope) VALUES ($1, $2, 'IFRS', 'GLOBAL') RETURNING id`, [tenantId, `I${tag}`]);
  await runner.query(`UPDATE chart_of_accounts SET is_consolidation = true WHERE tenant_id = $1 AND id = $2`, [tenantId, ifrs]);
  const company = (name: string) => one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, $2, 'FR', 'Brest', $3) RETURNING id`, [tenantId, name, local]);
  const companies = { a: await company('Company A'), b: await company('Company B') };
  const account = (coa: string, number: number, name: string, expected: boolean, units: Unit[] | null, consolidation: number | null) => one(runner,
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, quantity_price_expected, expected_units, consolidation_account_number)
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7) RETURNING id`, [tenantId, coa, number, name, expected ? true : null, units, consolidation]);
  await account(ifrs, 2400, 'External services', true, ['people', 'days'], null);
  const accounts: Record<AccountKey, string> = {
    ppl: await account(local, 621100, 'Temporary staff', true, ['people', 'days'], null),
    none: await account(local, 623000, 'Advertising', false, null, null),
    under: await account(local, 622100, 'Fees', false, null, 2400),
    modeOnly: await account(local, 651000, 'Licences', true, null, 2400),
  };
  const supplier = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Acme') RETURNING id`, [tenantId]);
  const calendar = await one(runner,
    `INSERT INTO working_day_profiles (tenant_id, code, name, days_by_year) VALUES ($1, 'STD', 'Standard', $2::jsonb) RETURNING id`,
    [tenantId, JSON.stringify({ [Y]: Array(12).fill('20') })]);

  const lines: Record<number, string> = {};
  for (const line of LINES) {
    const id = await one(runner,
      `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, paying_company_id, account_id, supplier_id)
       VALUES ($1, 'opex', $2, $3, 'EUR', '2020-01-01', 'enabled', $4, $5, $6) RETURNING id`,
      [tenantId, line.n, `Line ${line.n}`, companies[line.company], accounts[line.account], supplier]);
    lines[line.n] = id;
    const version = await one(runner,
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year) VALUES ($1, $2, $3, $4::date, $5) RETURNING id`,
      [tenantId, id, `Y${Y}`, `${Y}-01-01`, Y]);
    for (const column of line.columns) {
      for (let month = 1; month <= 12; month += 1) {
        await runner.query(`INSERT INTO spend_amounts (tenant_id, version_id, period, ${column.measure}) VALUES ($1, $2, make_date($3, $4, 1), 100)
          ON CONFLICT (version_id, period) DO UPDATE SET ${column.measure} = EXCLUDED.${column.measure}`, [tenantId, version, Y, month]);
      }
      const round = await one(runner,
        `INSERT INTO spend_round_inputs (tenant_id, version_id, measure, period_start, period_end, method)
         VALUES ($1, $2, $3, make_date($4, 1, 1), make_date($4, 12, 31), $5) RETURNING id`,
        [tenantId, version, column.measure, Y, column.units === 'spread' ? 'spread' : 'computed']);
      if (column.units === 'spread') continue;
      for (const [index, unit] of column.units.entries()) {
        const [basis, frequency, profile] = { people: ['per_month', 'per_month', null], days: ['per_day', 'once', calendar], pieces: ['per_piece', 'once', null] }[unit];
        await runner.query(
          `INSERT INTO spend_round_input_lines (tenant_id, round_input_id, sort, label, quantity_unit, quantity, unit_price, price_basis, frequency, working_day_profile_id, period_start, period_end)
           VALUES ($1, $2, $3, 'Line', $4, 1, 100, $5, $6, $7, make_date($8, 1, 1), make_date($8, 12, 31))`,
          [tenantId, round, index + 1, unit, basis, frequency, profile, Y]);
      }
    }
  }
  await runner.query(`INSERT INTO item_sequences (tenant_id, entity_type, next_val) VALUES ($1, 'spend', $2)`, [tenantId, LINES.length + 1]);
  return { tenantId, users, companies, accounts, lines, conversations: {} };
}

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-budget-entry-check-units.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { BudgetLinesService } = require('../../spend/budget-lines.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return {
    app,
    dataSource: app.get(DataSource),
    tools: app.get(AiToolRegistry),
    previews: app.get(AiMutationPreviewService),
    budgetLines: app.get(BudgetLinesService, { strict: false }),
  };
}

function context(seed: Seed, runner: QueryRunner, label: string, userId = seed.users.member) {
  const key = `${userId}:${label}`;
  seed.conversations[key] ||= randomUUID();
  return {
    tenantId: seed.tenantId, userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    conversationId: seed.conversations[key], manager: runner.manager,
  };
}

async function card(harness: Harness, ctx: any, tool: string, input: Record<string, unknown>) {
  await ctx.manager.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'Entry check units', 'custom', 'units-model', 'custom', now(), now()) ON CONFLICT (id) DO NOTHING`,
    [ctx.conversationId, ctx.tenantId, ctx.userId],
  );
  const preview = await harness.tools.execute(ctx, tool, input) as any;
  assert.equal(preview.status, 'pending', `${tool}: a card to approve (${preview.error_message ?? ''})`);
  return preview;
}

async function approve(harness: Harness, ctx: any, preview: any) {
  const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
  assert.equal(executed.status, 'executed', executed.error_message || 'the card did not execute');
  return executed;
}

async function inSeed(harness: Harness, test: (runner: QueryRunner, seed: Seed) => Promise<void>) {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await test(runner, await seedGraph(runner));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function savepoint(runner: QueryRunner, fn: () => Promise<void>) {
  await runner.query('SAVEPOINT entry_units');
  try {
    await fn();
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT entry_units');
  }
}

/** The item numbers of `ns` the rule reads as to check, once written. */
async function toCheck(runner: QueryRunner, seed: Seed, ns: number[]): Promise<number[]> {
  const checks = await readEntryChecks(runner.manager, seed.tenantId, ns.map((n) => seed.lines[n]));
  return ns.filter((n) => checks.get(seed.lines[n])?.to_check);
}

async function testScreenBulk(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    assert.deepEqual(await toCheck(runner, seed, [4, 6, 7]), [], 'as seeded, the lines on expected accounts conform');
    const opts = { manager: runner.manager };
    const write = async (ns: number[], account: AccountKey) => {
      const body = { ids: ns.map((n) => seed.lines[n]), changes: { account_id: seed.accounts[account] } };
      const dry = await harness.budgetLines.bulkUpdate({ ...body, dry_run: true }, seed.users.member, opts);
      const done = await harness.budgetLines.bulkUpdate({ ...body, as_of: dry.as_of, expected_rows: dry.rows, fingerprint: dry.fingerprint }, seed.users.member, opts);
      return [dry.to_check.rows, done.to_check.rows];
    };
    for (const [what, ns, account, rows, after] of [
      ['onto people and days: pieces only counted, pieces and days not', [1, 2], 'ppl', 1, [1]],
      ['onto an account mapped to the consolidation account on people and days', [1, 2], 'under', 1, [1]],
      ['onto an account set without units, under that consolidation account: the mode alone', [1, 2], 'modeOnly', 0, []],
    ] as const) {
      await savepoint(runner, async () => {
        assert.deepEqual(await write([...ns], account), [rows, rows], `${what}: the dry run and the write`);
        assert.deepEqual(await toCheck(runner, seed, [...ns]), after, `${what}: once written`);
      });
    }
    console.log('  the change in bulk of the screen counts the units, both levels as a block: OK');
  });
}

async function testKadBulk(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const preview = await card(harness, context(seed, runner, 'bulk'), 'bulk_update_budget_lines', { field: 'account', value: '621100', rows: ['BL-1', 'BL-2', 'BL-5'] });
    assert.match(preview.changes.budget_line_bulk_edit.to, /To check: 2(\n|$)/, preview.changes.budget_line_bulk_edit.to);
    assert.equal(preview.changes[WARNING_FIELD]?.to,
      `The account ${PPL} expects quantity and price entry, with calculation lines in people or days: the amounts not entered that way will be to check, to complete on the Budget tab of each line.`);
    if (!(await runner.query(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`))[0].present) {
      if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
      console.log('  skip - kanap_data_limited not installed');
      return;
    }
    // Every line of Acme onto the account: 1, 3, 5 and 6 to check (2 holds a line in days; 4 and 7 already there).
    const input = { field: 'account', value: '621100', filters: { supplier: ['Acme'] } };
    const everyone = await card(harness, context(seed, runner, 'all'), 'bulk_update_budget_lines', input);
    assert.match(everyone.changes.budget_line_bulk_edit.to, /To check: 4/);
    await runner.query(`INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access) VALUES ($1, $2, 'company', $3, 'edit')`,
      [seed.tenantId, seed.users.limited, seed.companies.a]);
    const ctx = context(seed, runner, 'limited', seed.users.limited);
    await ctx.manager.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
       VALUES ($1, $2, $3, 'Entry check units', 'custom', 'units-model', 'custom', now(), now()) ON CONFLICT (id) DO NOTHING`,
      [ctx.conversationId, ctx.tenantId, ctx.userId]);
    assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [seed.users.limited]))[0].mode, 'limited');
    const limited = await card(harness, ctx, 'bulk_update_budget_lines', input);
    assert.match(limited.changes.budget_line_bulk_edit.to, /To check: 3/, 'a limited person: the lines of company A only (1, 5, 6)');
    console.log('  Kad\'s card in bulk: the count and the warning with the units, a limited person\'s own lines: OK');
  });
}

async function testKadLineCards(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    for (const [what, ref, account, warning] of [
      ['pieces only onto people and days: the unit alone', 'BL-1', 'ppl', UNITS_WARNING(PPL)],
      ['pieces and days onto people and days', 'BL-2', 'ppl', undefined],
      ['a spread budget onto people and days: the mode, with the units', 'BL-5', 'ppl', ACCOUNT_WARNING],
      ['pieces only onto an account under the consolidation account on people and days', 'BL-1', 'under', UNITS_WARNING('622100 - Fees')],
      ['pieces only onto an account set without units under it', 'BL-1', 'modeOnly', undefined],
    ] as const) {
      await savepoint(runner, async () => {
        const ctx = context(seed, runner, `account-${what}`);
        const preview = await card(harness, ctx, 'update_business_record', { entity_type: 'budget_lines', ref, fields: { account_id: seed.accounts[account] } });
        assert.equal(preview.changes[WARNING_FIELD]?.to, warning, what);
        await approve(harness, ctx, preview);
        const n = Number(ref.slice(3));
        assert.deepEqual(await toCheck(runner, seed, [n]), warning ? [n] : [], `${what}, once written`);
      });
    }
    await savepoint(runner, async () => {
      const ctx = context(seed, runner, 'amounts');
      const preview = await card(harness, ctx, 'write_financial_plan', {
        entity_type: 'budget_lines', ref: 'BL-4', action: 'upsert_amounts', version_ref: `Y${Y}`, amounts: { kind: 'annual', year: Y, totals: { planned: 2400 } },
      });
      assert.equal(preview.changes[WARNING_FIELD]?.to, AMOUNTS_WARNING, 'a total on an account with units: the units said');
    });
    console.log('  Kad\'s cards of one line: the unit problem in the Budget tab\'s words, the mode with the units: OK');
  });
}

async function testBudgetFile(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    // Required here: the fixtures read the feature flags, set above, when they load.
    const { exportBudgetFile, loadBudgetFile, preflightBudgetFile, withCell } = require('../../spend/__tests__/budget-file.fixtures');
    const csv = await exportBudgetFile(runner.manager, 'opex', seed.tenantId, [1, 2, 5].map((n) => seed.lines[n]));
    const warned = async (content: string) => {
      const report = await preflightBudgetFile(runner.manager, 'opex', seed.tenantId, content);
      assert.equal(report.ok, true, JSON.stringify(report.errors));
      return (report.warnings.consistency ?? [])
        .filter((warning: any) => String(warning.code).startsWith('BUDGET_FILE_QUANTITY_PRICE'))
        .map((warning: any) => [warning.code, warning.params, warning.message]);
    };
    const onto = (number: string): string => withCell(csv, 'account_number', number);
    await savepoint(runner, async () => {
      assert.deepEqual(await warned(onto('621100')), [
        ['BUDGET_FILE_QUANTITY_PRICE_UNITS', { account: '621100', units: 'people or days', columns: `Budget ${Y}` },
          `Account 621100 expects calculation lines in people or days: complete Budget ${Y} on the line's Budget tab.`],
        ['BUDGET_FILE_QUANTITY_PRICE_EXPECTED_UNITS', { account: '621100', units: 'people or days', columns: `Budget ${Y}` },
          `Account 621100 expects quantity and price entry, with calculation lines in people or days: complete Budget ${Y} on the line's Budget tab.`],
      ], 'line 1: the unit alone; line 5: the mode with the units; line 2: nothing');
      await loadBudgetFile(runner.manager, 'opex', seed.tenantId, onto('621100'));
      assert.deepEqual(await toCheck(runner, seed, [1, 2, 5]), [1, 5], 'the load leaves to check what the file said');
    });
    assert.deepEqual((await warned(onto('622100'))).map(([code, params]: any[]) => [code, params.columns]),
      [['BUDGET_FILE_QUANTITY_PRICE_UNITS', `Budget ${Y}`], ['BUDGET_FILE_QUANTITY_PRICE_EXPECTED_UNITS', `Budget ${Y}`]],
      'under the consolidation account on people and days: its units');
    assert.deepEqual((await warned(onto('651000'))).map(([code]: any[]) => code), ['BUDGET_FILE_QUANTITY_PRICE_EXPECTED'],
      'an account set without units under it: the mode alone (line 5)');
    console.log('  the budget file says the unit problem or the mode with the units, as the load reads: OK');
  });
}

async function testCopy(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const { SpendBudgetOperationsService } = require('../../spend/spend-budget-operations.service');
    const operations = harness.app.get(SpendBudgetOperationsService, { strict: false });
    const opts = { manager: runner.manager, toCheck: (ids: string[]) => harness.budgetLines.countLinesToCheck(ids, { manager: runner.manager }) };
    // The hidden Forecast copied with its lines onto the Revision: in pieces (4), in pieces and people (7).
    const done = await operations.copyBudget({
      scope: 'opex', sourceYear: Y, destinationYear: Y, overwrite: true, dryRun: false,
      amounts: { sourceColumn: 'forecast', destinationColumn: 'revision', percentageIncrease: 0 },
    }, seed.users.member, opts);
    assert.deepEqual(await toCheck(runner, seed, [4, 7]), [4], 'the copy in pieces is to check, the one with a line in people is not');
    assert.deepEqual(done.summary.toCheck, { rows: 1, checks: { quantity_price: 1 } }, 'the answer counts it');
    console.log('  the copy of budget columns counts the units: OK');
  });
}

async function run() {
  const harness = await createHarness();
  const failures: string[] = [];
  try {
    for (const test of [testScreenBulk, testKadBulk, testKadLineCards, testBudgetFile, testCopy]) {
      try {
        await test(harness);
      } catch (error) {
        console.error(error);
        failures.push(`${test.name}: ${String((error as Error)?.message ?? error).split('\n')[0]}`);
      }
    }
  } finally {
    await harness.app.close();
  }
  if (failures.length) throw new Error(`ai-budget-entry-check-units.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  console.log('ai-budget-entry-check-units.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
