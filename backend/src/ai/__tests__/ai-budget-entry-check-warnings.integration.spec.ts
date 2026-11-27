import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { readEntryChecks } from '../../spend/budget-line-entry-check';

// The paths that write budget lines without the person seeing the line's "To
// check" warning say it. The rule is the one of lot B12a (`spend/budget-line-entry-check.ts`); each
// case below is read back with `readEntryChecks` once written, so what was said is what the line reads.
//
// - The change in bulk of the screen (`BudgetLinesService.bulkUpdate`, the common contract): the dry
//   run and the write count the written rows the list's "To check" column will show (every check),
//   an account ticked or not, rows already to check, a frozen or hidden column; nothing refused. The
//   count of 500 lines the statistics do not know stays within its time limit; a count that does not
//   finish leaves the write done, answered without the number.
// - Kad's card in bulk: the same count at the preview and once written, the warning while it waits
//   for an account that expects quantity and price, a limited person's own lines only.
// - Kad's cards of one line: its amounts (`write_financial_plan` upsert_amounts), a new line with its
//   amounts (`create_business_record`), its account (`update_business_record`). The warning names the
//   line's own account and says where to complete it; approval writes as before; the written card
//   does not repeat it; no warning when nothing will be to check (another account, a zero, a hidden
//   column). A card warns if and only if the line is to check once written because of the card (an
//   undo, a month as stored, a move with an end, an end of validity alone), as the list reads it.
// - "Copy budget columns": its answer counts the lines it wrote that are to check, as the list shows them.
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
const TICK_LABEL = '621100 - Temporary staff';
const AMOUNTS_WARNING = `The account ${TICK_LABEL} expects quantity and price entry, and Kad only writes a total: this amount will be to check, to complete on the line's Budget tab.`;
const ACCOUNT_WARNING = `The account ${TICK_LABEL} expects quantity and price entry: the amounts not entered that way will be to check, to complete on the Budget tab of the line.`;

type Harness = { app: any; dataSource: DataSource; tools: any; previews: any; budgetLines: any };
type Seed = {
  tenantId: string;
  users: { member: string; limited: string };
  companies: { a: string; b: string };
  accounts: { tick: string; cons: string; none: string };
  /** Item number → id. */
  lines: Record<number, string>;
  conversations: Record<string, string>;
};

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return String((await runner.query(sql, params))[0].id);
}

async function seedRole(runner: QueryRunner, tenantId: string, name: string, permissions: Record<string, string>) {
  const roleId = await one(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, $2, false, false, now(), now()) RETURNING id`, [tenantId, name]);
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())`,
      [tenantId, roleId, resource, level]);
  }
  return roleId;
}

async function seedUser(runner: QueryRunner, tenantId: string, roleId: string, first: string, mode: 'all' | 'limited' = 'all') {
  return one(runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, locale, data_access_mode, created_at, updated_at)
     VALUES ($1, $2, 'Tester', $3, $4, false, 'enabled', 'en', $5, now(), now()) RETURNING id`,
    [tenantId, first, `${first.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`, roleId, mode]);
}

type Column = { year: number; measure: 'planned' | 'committed' | 'forecast'; months: number[]; method: 'spread' | 'computed' };
type LineDef = { n: number; account: 'tick' | 'cons' | 'none'; company: 'a' | 'b'; columns: Column[]; end?: string };

const spread = (year = Y): Column => ({ year, measure: 'planned', months: Array(12).fill(100), method: 'spread' });
const qp = (year = Y): Column => ({ year, measure: 'planned', months: Array(12).fill(100), method: 'computed' });

/**
 * 1, 2: spread budgets on an account that expects nothing. 3: a spread budget on the ticked account
 * (already to check). 4: as 1, paid by company B. 5: built as quantity × price on the ticked account.
 * 6: a forecast only (the column is hidden). 7: next year's budget only (frozen). 8: built as
 * quantity × price on an account ticked through its consolidation account. 9: Budget and Revision
 * both built as quantity × price on the ticked account. 10: on the ticked account, ended last year:
 * last year's Budget built as quantity × price, this year's spread (after its end: not looked at).
 */
const LINES: LineDef[] = [
  { n: 1, account: 'none', company: 'a', columns: [spread()] },
  { n: 2, account: 'none', company: 'a', columns: [spread()] },
  { n: 3, account: 'tick', company: 'a', columns: [spread()] },
  { n: 4, account: 'none', company: 'b', columns: [spread()] },
  { n: 5, account: 'tick', company: 'a', columns: [qp()] },
  { n: 6, account: 'none', company: 'a', columns: [{ year: Y, measure: 'forecast', months: [500], method: 'spread' }] },
  { n: 7, account: 'none', company: 'a', columns: [spread(Y + 1)] },
  { n: 8, account: 'cons', company: 'a', columns: [qp()] },
  { n: 9, account: 'tick', company: 'a', columns: [qp(), { ...qp(), measure: 'committed' }] },
  { n: 10, account: 'tick', company: 'a', columns: [qp(Y - 1), spread()], end: `${Y - 1}-06-30T12:00:00Z` },
];

async function seedGraph(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `entry-warn-${tag}`, `Entry warnings ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const model = await one(runner,
    `INSERT INTO ai_model_configs (tenant_id, name, provider, model, endpoint_url, api_key_encrypted, supports_vision, is_default, created_at, updated_at)
     VALUES ($1, 'warn-model', 'custom', 'warn-model', 'https://llm.example.test/v1', 'test-secret', true, true, now(), now()) RETURNING id`, [tenantId]);
  await runner.query(
    `INSERT INTO ai_settings (tenant_id, chat_enabled, mcp_enabled, provider_source, llm_provider, llm_endpoint_url, llm_model,
                              llm_api_key_encrypted, web_search_enabled, glpi_enabled, chat_model_config_id, created_at, updated_at)
     VALUES ($1, true, true, 'custom', 'custom', 'https://llm.example.test/v1', 'warn-model', 'test-secret', false, false, $2, now(), now())`,
    [tenantId, model]);
  const member = await seedRole(runner, tenantId, 'Budget member', { ai_chat: 'member', budget: 'member' });
  const users = { member: await seedUser(runner, tenantId, member, 'Member'), limited: await seedUser(runner, tenantId, member, 'Limited', 'limited') };

  const local = await one(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, $2, 'Local', 'FR') RETURNING id`, [tenantId, `L${tag}`]);
  const ifrs = await one(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, scope) VALUES ($1, $2, 'IFRS', 'GLOBAL') RETURNING id`, [tenantId, `I${tag}`]);
  await runner.query(`UPDATE chart_of_accounts SET is_consolidation = true WHERE tenant_id = $1 AND id = $2`, [tenantId, ifrs]);
  const company = (name: string) => one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, $2, 'FR', 'Brest', $3) RETURNING id`, [tenantId, name, local]);
  const companies = { a: await company('Company A'), b: await company('Company B') };
  const account = (coa: string, number: number, name: string, expected: boolean, consolidation: number | null) => one(runner,
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, quantity_price_expected, consolidation_account_number)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [tenantId, coa, number, name, expected ? true : null, consolidation]);
  await account(ifrs, 2400, 'External services', true, null);
  await account(ifrs, 2500, 'Purchases', false, null);
  const accounts = {
    tick: await account(local, 621100, 'Temporary staff', true, 2500),
    cons: await account(local, 622100, 'Fees', false, 2400),
    none: await account(local, 623000, 'Advertising', false, 2500),
  };
  const supplier = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Acme') RETURNING id`, [tenantId]);
  await runner.query(`INSERT INTO freeze_states (tenant_id, budget_year, scope, column_key, is_frozen) VALUES ($1, $2, 'opex', 'budget', true)`, [tenantId, Y + 1]);

  const lines: Record<number, string> = {};
  for (const line of LINES) {
    const id = await one(runner,
      `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, paying_company_id, account_id, supplier_id, disabled_at)
       VALUES ($1, 'opex', $2, $3, 'EUR', '2020-01-01', 'enabled', $4, $5, $6, $7) RETURNING id`,
      [tenantId, line.n, `Line ${line.n}`, companies[line.company], accounts[line.account], supplier, line.end ?? null]);
    lines[line.n] = id;
    const versions = new Map<number, string>();
    for (const column of line.columns) {
      let versionId = versions.get(column.year);
      if (!versionId) {
        versionId = await one(runner,
          `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year) VALUES ($1, $2, $3, $4::date, $5) RETURNING id`,
          [tenantId, id, `Y${column.year}`, `${column.year}-01-01`, column.year]);
        versions.set(column.year, versionId);
      }
      for (const [month, value] of column.months.entries()) {
        await runner.query(`INSERT INTO spend_amounts (tenant_id, version_id, period, ${column.measure}) VALUES ($1, $2, make_date($3, $4, 1), $5::numeric)
          ON CONFLICT (version_id, period) DO UPDATE SET ${column.measure} = EXCLUDED.${column.measure}`,
          [tenantId, versionId, column.year, month + 1, value]);
      }
      const round = await one(runner,
        `INSERT INTO spend_round_inputs (tenant_id, version_id, measure, period_start, period_end, method)
         VALUES ($1, $2, $3, make_date($4, 1, 1), make_date($4, 12, 31), $5) RETURNING id`,
        [tenantId, versionId, column.measure, column.year, column.method]);
      if (column.method === 'computed') {
        await runner.query(
          `INSERT INTO spend_round_input_lines (tenant_id, round_input_id, sort, label, quantity_unit, quantity, unit_price, price_basis, frequency, period_start, period_end)
           VALUES ($1, $2, 1, 'Licences', 'pieces', 2, 600, 'per_piece', 'once', make_date($3, 1, 1), make_date($3, 12, 31))`,
          [tenantId, round, column.year]);
      }
    }
  }
  // The numbers the seed took: the next line created gets BL-9.
  await runner.query(`INSERT INTO item_sequences (tenant_id, entity_type, next_val) VALUES ($1, 'spend', $2)`, [tenantId, LINES.length + 1]);
  return { tenantId, users, companies, accounts, lines, conversations: {} };
}

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-budget-entry-check-warnings.integration.spec.ts.');
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
     VALUES ($1, $2, $3, 'Entry check warnings', 'custom', 'warn-model', 'custom', now(), now()) ON CONFLICT (id) DO NOTHING`,
    [ctx.conversationId, ctx.tenantId, ctx.userId],
  );
  const preview = await harness.tools.execute(ctx, tool, input) as any;
  assert.equal(preview.status, 'pending', `${tool}: a card to approve`);
  return preview;
}

async function approve(harness: Harness, ctx: any, preview: any) {
  const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
  assert.equal(executed.status, 'executed', executed.error_message || 'the card did not execute');
  assert.equal(executed.changes?.[WARNING_FIELD], undefined, 'the written card does not say it again');
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
  await runner.query('SAVEPOINT entry_warn');
  try {
    await fn();
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT entry_warn');
  }
}

/** The item numbers of `ns` the rule reads as to check, once written. */
async function toCheck(runner: QueryRunner, seed: Seed, ns: number[]): Promise<number[]> {
  const checks = await readEntryChecks(runner.manager, seed.tenantId, ns.map((n) => seed.lines[n]));
  return ns.filter((n) => checks.get(seed.lines[n])?.to_check);
}

async function testScreenBulk(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const opts = { manager: runner.manager };
    const write = async (ids: string[], changes: Record<string, unknown>) => {
      const body = { ids, changes };
      const dry = await harness.budgetLines.bulkUpdate({ ...body, dry_run: true }, seed.users.member, opts);
      const done = await harness.budgetLines.bulkUpdate({ ...body, as_of: dry.as_of, expected_rows: dry.rows, fingerprint: dry.fingerprint }, seed.users.member, opts);
      return { dry, done };
    };
    await savepoint(runner, async () => {
      // Onto the ticked account: 1 and 2 to check; 6 (hidden column) and 7 (frozen column) not.
      const { dry, done } = await write([1, 2, 6, 7].map((n) => seed.lines[n]), { account_id: seed.accounts.tick });
      assert.deepEqual(dry.to_check, { rows: 2, checks: { quantity_price: 2 } }, 'the dry run counts the rows it would leave to check');
      assert.deepEqual([done.changed, done.to_check], [4, { rows: 2, checks: { quantity_price: 2 } }], 'the write counts the same, and writes every row');
      assert.deepEqual(await toCheck(runner, seed, [1, 2, 6, 7]), [1, 2], 'what the lines read once written');
    });
    await savepoint(runner, async () => {
      // Off the ticked account onto one that expects nothing: none to check.
      const { dry, done } = await write([seed.lines[3], seed.lines[5]], { account_id: seed.accounts.none });
      assert.deepEqual([dry.to_check, done.to_check], [{ rows: 0, checks: {} }, { rows: 0, checks: {} }], 'an account not ticked: none');
      assert.deepEqual(await toCheck(runner, seed, [3, 5]), []);
    });
    await savepoint(runner, async () => {
      // Another field on a line already to check and on one that is not: the written row already to check counts.
      const { dry, done } = await write([seed.lines[3], seed.lines[1]], { run_build: 'build' });
      assert.deepEqual([dry.to_check, done.to_check], [{ rows: 1, checks: { quantity_price: 1 } }, { rows: 1, checks: { quantity_price: 1 } }], 'already to check: counted');
    });
    await savepoint(runner, async () => {
      // A row that already holds the value is not written, so not counted.
      const { done } = await write([seed.lines[3], seed.lines[2]], { account_id: seed.accounts.tick });
      assert.deepEqual([done.changed, done.unchanged, done.to_check], [1, 1, { rows: 1, checks: { quantity_price: 1 } }], 'the written rows only');
    });
    console.log('  the change in bulk of the screen: the dry run and the write count the written rows to check: OK');
  });
}

/**
 * The count of a change in bulk of 500 lines, in the transaction that created them (the statistics do
 * not know them, as after a load not analysed yet): under the count's own time limit, every line is
 * counted, and the statement reads the selection's versions once (the reviewer's 102 s case).
 */
async function testCountOfFiveHundred(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ids: string[] = (await runner.query(
      `WITH li AS (
         INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, paying_company_id, account_id)
         SELECT $1, 'opex', 1000 + g, 'Bulk ' || g, 'EUR', '2020-01-01', 'enabled', CASE WHEN g % 2 = 0 THEN $2::uuid ELSE $3::uuid END, $4
           FROM generate_series(1, 500) g RETURNING id)
       SELECT id::text AS id FROM li`, [seed.tenantId, seed.companies.a, seed.companies.b, seed.accounts.tick])).map((r: any) => r.id);
    await runner.query(
      `WITH v AS (INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year)
                  SELECT $1, id, 'Y' || $3::int, make_date($3::int, 1, 1), $3::int FROM spend_items WHERE tenant_id = $1 AND id = ANY($2::uuid[]) RETURNING id)
       INSERT INTO spend_amounts (tenant_id, version_id, period, planned)
       SELECT $1, v.id, make_date($3::int, m, 1), 100 FROM v CROSS JOIN generate_series(1, 12) m`, [seed.tenantId, ids, Y]);
    const { budgetListLineChecksByIds } = require('../../spend/budget-list/budget-list.service');
    const { SUMMARY_SCOPES } = require('../../spend/spend-summary.builder');
    const { BULK_TO_CHECK_LIMITS } = require('../../common/bulk-edit/bulk-edit');
    const deps = { fxRates: (harness.budgetLines as any).fxRates, access: undefined };
    const statements: string[] = [];
    const original = runner.manager.query.bind(runner.manager);
    (runner.manager as any).query = (sql: string, params?: unknown[]) => { statements.push(sql); return original(sql, params); };
    await runner.query(`SAVEPOINT five_hundred`);
    await runner.query(`SELECT set_config('statement_timeout', $1, true)`, [BULK_TO_CHECK_LIMITS.statementTimeout]);
    const started = Date.now();
    let counted: Map<string, unknown>;
    try {
      counted = await budgetListLineChecksByIds(SUMMARY_SCOPES.all, deps, runner.manager, ids);
    } finally {
      (runner.manager as any).query = original;
      await runner.query(`ROLLBACK TO SAVEPOINT five_hundred`);
    }
    const elapsed = Date.now() - started;
    assert.equal(counted.size, 500, 'every line counted within the count\'s time limit');
    assert.ok(statements.some((sql) => /ec_selection_versions AS MATERIALIZED/.test(sql)), 'the selection\'s versions read once');
    await runner.query(`INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access) VALUES ($1, $2, 'company', $3, 'edit')`,
      [seed.tenantId, seed.users.limited, seed.companies.a]);
    if ((await runner.query(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`))[0].present) {
      await runner.query(`SAVEPOINT five_hundred_limited`);
      await runner.query(`SELECT data_access_apply($1)`, [seed.users.limited]);
      await runner.query(`SELECT set_config('statement_timeout', $1, true)`, [BULK_TO_CHECK_LIMITS.statementTimeout]);
      try {
        const limited = await budgetListLineChecksByIds(SUMMARY_SCOPES.all, deps, runner.manager, ids);
        assert.equal(limited.size, 250, 'a limited person: the lines of their company');
      } finally {
        await runner.query(`ROLLBACK TO SAVEPOINT five_hundred_limited`);
      }
    }
    console.log(`  the count of a change in bulk of 500 lines the statistics do not know: ${elapsed} ms: OK`);
  });
}

/**
 * The count is optional: when it does not finish (forced here past its time limit), the change in
 * bulk still writes and answers without the number, the transaction goes on, and the person's own
 * time limit is the one in force afterwards, as it is after a count that finished.
 */
async function testCountThatFails(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const opts = { manager: runner.manager };
    const listService = require('../../spend/budget-list/budget-list.service');
    const limits = require('../../common/bulk-edit/bulk-edit').BULK_TO_CHECK_LIMITS;
    const timeout = async () => (await runner.query(`SELECT current_setting('statement_timeout') AS s`))[0].s as string;
    const ids = [seed.lines[1], seed.lines[2]];
    const write = async () => {
      const dry = await harness.budgetLines.bulkUpdate({ ids, changes: { account_id: seed.accounts.tick }, dry_run: true }, seed.users.member, opts);
      const done = await harness.budgetLines.bulkUpdate({ ids, changes: { account_id: seed.accounts.tick }, as_of: dry.as_of, expected_rows: dry.rows, fingerprint: dry.fingerprint }, seed.users.member, opts);
      return { dry, done };
    };
    await savepoint(runner, async () => {
      await runner.query(`SET LOCAL statement_timeout = '45s'`);
      const { done } = await write();
      assert.deepEqual(done.to_check, { rows: 2, checks: { quantity_price: 2 } });
      assert.equal(await timeout(), '45s', 'the time limit in force before the count, after it');
    });
    const original = listService.budgetListLineChecksByIds;
    const limit = limits.statementTimeout;
    listService.budgetListLineChecksByIds = async (_scope: unknown, _deps: unknown, manager: any) => {
      await manager.query(`SELECT pg_sleep(2)`);
      return new Map();
    };
    limits.statementTimeout = '200ms';
    try {
      await savepoint(runner, async () => {
        await runner.query(`SET LOCAL statement_timeout = '45s'`);
        const { dry, done } = await write();
        assert.equal(dry.to_check, undefined, 'the dry run answers without the number');
        assert.deepEqual([done.changed, done.to_check], [2, undefined], 'the write is done and answers without the number');
        assert.equal(await timeout(), '45s', 'the time limit in force before the count, after it');
        const accounts = await runner.query(`SELECT account_id FROM spend_items WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [seed.tenantId, ids]);
        assert.deepEqual(accounts.map((row: any) => row.account_id), [seed.accounts.tick, seed.accounts.tick], 'the lines are written');
      });
    } finally {
      listService.budgetListLineChecksByIds = original;
      limits.statementTimeout = limit;
    }
    console.log('  a count that does not finish: the change in bulk writes and answers without it: OK');
  });
}

async function testKadBulkCard(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'bulk');
    const preview = await card(harness, ctx, 'bulk_update_budget_lines', { field: 'account', value: '621100', rows: ['BL-1', 'BL-2', 'BL-6'] });
    const text = preview.changes.budget_line_bulk_edit.to as string;
    assert.match(text, /3 lines to change\n\nTo check: 2(\n|$)/, `the preview counts them: ${text}`);
    const warning = preview.changes[WARNING_FIELD];
    assert.equal(warning?.label, 'To check');
    assert.match(warning?.to, /^The account .*621100.* expects quantity and price entry: the amounts not entered that way will be to check, to complete on the Budget tab of each line\.$/);
    assert.deepEqual(preview.actions, ['approve', 'reject'], 'approval stays possible');
    const executed = await approve(harness, ctx, preview);
    assert.match(executed.changes.budget_line_bulk_edit.to, /\n\nTo check: 2$/, 'the written card says how many');
    assert.deepEqual(await toCheck(runner, seed, [1, 2, 6]), [1, 2]);

    // Another field on rows already to check: the count, no warning (the account does not change).
    const other = await card(harness, context(seed, runner, 'bulk-other'), 'bulk_update_budget_lines', { field: 'run_build', value: 'build', rows: ['BL-1', 'BL-5'] });
    assert.match(other.changes.budget_line_bulk_edit.to, /To check: 1/);
    assert.equal(other.changes[WARNING_FIELD], undefined, 'another field: no warning of the account');
    console.log('  Kad\'s card in bulk: the count at the preview and once written, the warning while it waits: OK');
  });
}

async function testKadBulkLimited(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    if (!(await runner.query(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`))[0].present) {
      if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
      console.log('  skip - kanap_data_limited not installed');
      return;
    }
    const input = { field: 'account', value: '621100', filters: { supplier: ['Acme'] } };
    const everyone = await card(harness, context(seed, runner, 'all'), 'bulk_update_budget_lines', input);
    // Every row: 1, 2, 4 left to check (3 and 5 already hold the account, 6 hidden, 7 frozen, 8 conforms).
    assert.match(everyone.changes.budget_line_bulk_edit.to, /To check: 3/);
    await runner.query(`INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access) VALUES ($1, $2, 'company', $3, 'edit')`,
      [seed.tenantId, seed.users.limited, seed.companies.a]);
    const ctx = context(seed, runner, 'limited', seed.users.limited);
    await ctx.manager.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
       VALUES ($1, $2, $3, 'Entry check warnings', 'custom', 'warn-model', 'custom', now(), now()) ON CONFLICT (id) DO NOTHING`,
      [ctx.conversationId, ctx.tenantId, ctx.userId],
    );
    assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [seed.users.limited]))[0].mode, 'limited');
    const limited = await card(harness, ctx, 'bulk_update_budget_lines', input);
    assert.match(limited.changes.budget_line_bulk_edit.to, /To check: 2/, 'a limited person counts their own lines only');
    assert.equal(JSON.stringify(limited).includes('BL-4'), false, 'nothing of the line outside the access');
    console.log('  Kad\'s card in bulk for a limited person: their own lines only: OK');
  });
}

async function testKadLineCards(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const amounts = (ref: string, totals: Record<string, number>) => ({
      entity_type: 'budget_lines', ref, action: 'upsert_amounts', version_ref: `Y${Y}`, amounts: { kind: 'annual', year: Y, totals },
    });
    // The amounts of a line built as quantity × price, on the ticked account: to check once written.
    await savepoint(runner, async () => {
      const ctx = context(seed, runner, 'amounts');
      const preview = await card(harness, ctx, 'write_financial_plan', amounts('BL-5', { planned: 2400 }));
      assert.deepEqual([preview.changes[WARNING_FIELD]?.label, preview.changes[WARNING_FIELD]?.to], ['To check', AMOUNTS_WARNING]);
      await approve(harness, ctx, preview);
      assert.deepEqual(await toCheck(runner, seed, [5]), [5]);
      // Its undo builds the column again from its lines: nothing to warn of, and it conforms again.
      const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
      assert.equal(undo.status, 'pending');
      assert.equal(undo.changes[WARNING_FIELD], undefined, 'the undo rebuilds quantity × price: no warning');
      await approve(harness, ctx, undo);
      assert.deepEqual(await toCheck(runner, seed, [5]), [], 'conforms again once undone');
    });
    // No warning: an account that expects nothing, a zero, a hidden column.
    for (const [what, input] of [
      ['another account', amounts('BL-1', { planned: 2400 })],
      ['a zero', amounts('BL-5', { planned: 0 })],
      ['a hidden column', amounts('BL-5', { forecast: 900 })],
    ] as const) {
      await savepoint(runner, async () => {
        const ctx = context(seed, runner, `amounts-${what}`);
        const preview = await card(harness, ctx, 'write_financial_plan', input);
        assert.equal(preview.changes[WARNING_FIELD], undefined, `${what}: no warning`);
        await approve(harness, ctx, preview);
        assert.deepEqual(await toCheck(runner, seed, [Number(String(input.ref).slice(3))]), [], `${what}: not to check once written`);
      });
    }

    // A new line with its amounts, on the ticked account and on one that expects nothing.
    const fields = (accountId: string, name: string) => ({
      nature: 'opex', product_name: name, paying_company_id: seed.companies.a, account_id: accountId, currency: 'EUR', effective_start: `${Y}-01-01`,
    });
    for (const [what, accountId, warned] of [['the ticked account', seed.accounts.tick, true], ['another account', seed.accounts.none, false]] as const) {
      await savepoint(runner, async () => {
        const ctx = context(seed, runner, `create-${what}`);
        const preview = await card(harness, ctx, 'create_business_record', {
          entity_type: 'budget_lines', fields: fields(accountId, `New on ${what}`), amounts: { kind: 'annual', year: Y, totals: { planned: 1200 } },
        });
        assert.equal(preview.changes[WARNING_FIELD]?.to, warned ? AMOUNTS_WARNING : undefined, `a new line on ${what}`);
        const executed = await approve(harness, ctx, preview);
        const id = executed.target.entity_id;
        const checks = await readEntryChecks(runner.manager, seed.tenantId, [id]);
        assert.equal(checks.get(id)?.to_check, warned, `the new line on ${what}, once written`);
      });
    }

    // The account of a line: onto the ticked account, a spread budget to check; a hidden column alone, nothing.
    for (const [what, ref, accountId, warned] of [
      ['a spread budget', 'BL-2', seed.accounts.tick, true],
      ['a hidden column alone', 'BL-6', seed.accounts.tick, false],
      ['onto an account that expects nothing', 'BL-3', seed.accounts.none, false],
    ] as const) {
      await savepoint(runner, async () => {
        const ctx = context(seed, runner, `account-${what}`);
        const preview = await card(harness, ctx, 'update_business_record', { entity_type: 'budget_lines', ref, fields: { account_id: accountId } });
        assert.equal(preview.changes[WARNING_FIELD]?.to, warned ? ACCOUNT_WARNING : undefined, `the account of a line, ${what}`);
        await approve(harness, ctx, preview);
        const n = Number(ref.slice(3));
        assert.deepEqual(await toCheck(runner, seed, [n]), warned ? [n] : [], `${what}, once written`);
        if (ref !== 'BL-3') return;
        // The undo puts the spread budget back on the ticked account: its card warns.
        const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
        assert.equal(undo.changes[WARNING_FIELD]?.to, ACCOUNT_WARNING, 'the undo back onto the ticked account warns');
        await approve(harness, ctx, undo);
        assert.deepEqual(await toCheck(runner, seed, [3]), [3]);
      });
    }
    console.log('  Kad\'s cards of one line: its amounts, a new line with amounts, its account; said while waiting, as the line reads once written: OK');
  });
}

/** Whether the list's "To check" column names the rule for line `n` (`budgetListLineChecksByIds`, the list's own field). */
async function listSaysToCheck(harness: Harness, runner: QueryRunner, seed: Seed, n: number): Promise<boolean> {
  const { budgetListLineChecksByIds } = require('../../spend/budget-list/budget-list.service');
  const { SUMMARY_SCOPES } = require('../../spend/spend-summary.builder');
  const checks: Map<string, string[]> = await budgetListLineChecksByIds(
    SUMMARY_SCOPES.all, { fxRates: (harness.budgetLines as any).fxRates, access: undefined }, runner.manager, [seed.lines[n]]);
  return (checks.get(seed.lines[n]) ?? []).includes('quantity_price');
}

/**
 * The rule of Kad's cards (adversarial review): a card warns if and only if the line is to
 * check once it is written because of what the card writes. Each case starts from a line that is not
 * to check, approves the card, and compares the warning with the list's "To check" column.
 */
async function testKadCardsWarnIffToCheck(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const iff = async (what: string, n: number, tool: string, input: Record<string, unknown>, expected: boolean) => {
      assert.equal(await listSaysToCheck(harness, runner, seed, n), false, `${what}: not to check before`);
      const ctx = context(seed, runner, what);
      const preview = await card(harness, ctx, tool, input);
      const warns = preview.changes[WARNING_FIELD] !== undefined;
      await approve(harness, ctx, preview);
      const after = await listSaysToCheck(harness, runner, seed, n);
      assert.deepEqual({ warns, after }, { warns: expected, after: expected }, `${what}: warns as the list reads once written`);
      return { ctx, preview };
    };
    const amounts = (ref: string, payload: Record<string, unknown>) => ({
      entity_type: 'budget_lines', ref, action: 'upsert_amounts', version_ref: `Y${Y}`, amounts: payload,
    });

    // R1: the undo of a total on a line whose Revision is also built as quantity × price.
    await savepoint(runner, async () => {
      const { ctx, preview } = await iff('a total on line 9', 9, 'write_financial_plan', amounts('BL-9', { kind: 'annual', year: Y, totals: { planned: 2400 } }), true);
      const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
      assert.equal(undo.status, 'pending');
      assert.equal(undo.changes[WARNING_FIELD], undefined, 'the undo rebuilds the Budget and leaves the Revision as it is: no warning');
      await approve(harness, ctx, undo);
      assert.equal(await listSaysToCheck(harness, runner, seed, 9), false, 'not to check once undone');
    });
    // R2: a month repeated as stored on a column built as quantity × price is not written; another value is.
    await savepoint(runner, async () => {
      await iff('a month as stored', 5, 'write_financial_plan', amounts('BL-5', { kind: 'monthly', year: Y, months: [{ period: `${Y}-01-01`, planned: '100' }] }), false);
    });
    await savepoint(runner, async () => {
      await iff('a month changed', 5, 'write_financial_plan', amounts('BL-5', { kind: 'monthly', year: Y, months: [{ period: `${Y}-01-01`, planned: '150' }] }), true);
    });
    // R3: one card moves line 1 onto the ticked account and ends it the year before its Budget.
    await savepoint(runner, async () => {
      await iff('a move with an end before the budget', 1, 'update_business_record',
        { entity_type: 'budget_lines', ref: 'BL-1', fields: { account_id: seed.accounts.tick, disabled_at: `${Y - 1}-06-30` } }, false);
    });
    await savepoint(runner, async () => {
      await iff('a move with an end after the budget', 1, 'update_business_record',
        { entity_type: 'budget_lines', ref: 'BL-1', fields: { account_id: seed.accounts.tick, disabled_at: `${Y}-12-31` } }, true);
    });
    // T5: from the ticked account to one ticked through its consolidation account, a line already to
    // check: the move leaves nothing new to check, no warning (as the budget file).
    await savepoint(runner, async () => {
      assert.equal(await listSaysToCheck(harness, runner, seed, 3), true, 'line 3 is to check before');
      const ctx = context(seed, runner, 'between two expected accounts');
      const preview = await card(harness, ctx, 'update_business_record', { entity_type: 'budget_lines', ref: 'BL-3', fields: { account_id: seed.accounts.cons } });
      assert.equal(preview.changes[WARNING_FIELD], undefined, 'between two expected accounts: no warning');
      await approve(harness, ctx, preview);
      assert.equal(await listSaysToCheck(harness, runner, seed, 3), true, 'still to check, as before');
    });
    // M3: on the ticked account, the end of validity alone, moved to a year with a spread Budget, or within its year.
    await savepoint(runner, async () => {
      await iff('an end brought to this year', 10, 'update_business_record',
        { entity_type: 'budget_lines', ref: 'BL-10', fields: { disabled_at: `${Y}-12-31` } }, true);
    });
    await savepoint(runner, async () => {
      await iff('an end moved within its year', 10, 'update_business_record',
        { entity_type: 'budget_lines', ref: 'BL-10', fields: { disabled_at: `${Y - 1}-12-31` } }, false);
    });
    console.log('  Kad\'s cards warn if and only if the line is to check once written because of the card: OK');
  });
}

/**
 * "Copy budget columns": its answer counts the lines whose amounts it wrote that the list's
 * "To check" column shows, as a change in bulk counts them. A hidden column copied as amounts onto a
 * shown one, on the ticked account, leaves line 6 to check; the count is the list's.
 */
async function testCopyCountsToCheck(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const { SpendBudgetOperationsService } = require('../../spend/spend-budget-operations.service');
    const operations = harness.app.get(SpendBudgetOperationsService, { strict: false });
    await runner.query(`UPDATE spend_items SET account_id = $2 WHERE tenant_id = $1 AND id = $3`, [seed.tenantId, seed.accounts.tick, seed.lines[6]]);
    assert.equal(await listSaysToCheck(harness, runner, seed, 6), false, 'line 6: its forecast is hidden, not to check');
    const opts = { manager: runner.manager, toCheck: (ids: string[]) => harness.budgetLines.countLinesToCheck(ids, { manager: runner.manager }) };
    const copy = (dryRun: boolean) => operations.copyBudget({
      scope: 'opex', sourceYear: Y, destinationYear: Y, overwrite: true, dryRun,
      amounts: { sourceColumn: 'forecast', destinationColumn: 'revision', percentageIncrease: 0 },
    }, seed.users.member, opts);
    const preview = await copy(true);
    assert.equal(preview.summary.toCheck, undefined, 'the preview writes nothing: no count');
    const done = await copy(false);
    const written = done.results.filter((line: any) => line.amounts && !line.amounts.skipped).map((line: any) => line.itemNumber as number);
    const listed: number[] = [];
    for (const n of written) if (await listSaysToCheck(harness, runner, seed, n)) listed.push(n);
    assert.ok(listed.includes(6), `line 6 is to check once copied (${listed.join(', ')})`);
    assert.deepEqual(done.summary.toCheck, { rows: listed.length, checks: { quantity_price: listed.length } }, 'the answer counts what the list shows');
    console.log('  the copy of budget columns counts the lines it wrote that are to check: OK');
  });
}

async function run() {
  const harness = await createHarness();
  try {
    await testScreenBulk(harness);
    await testCountOfFiveHundred(harness);
    await testCountThatFails(harness);
    await testKadBulkCard(harness);
    await testKadBulkLimited(harness);
    await testKadLineCards(harness);
    await testKadCardsWarnIffToCheck(harness);
    await testCopyCountsToCheck(harness);
  } finally {
    await harness.app.close();
  }
  console.log('ai-budget-entry-check-warnings.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
