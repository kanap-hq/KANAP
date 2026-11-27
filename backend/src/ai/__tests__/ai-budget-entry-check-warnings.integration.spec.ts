import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { readEntryChecks } from '../../spend/budget-line-entry-check';

// Lot B12b of 26.12.1: the paths that write budget lines without the person seeing the line's "To
// check" warning say it. The rule is the one of lot B12a (`spend/budget-line-entry-check.ts`); each
// case below is read back with `readEntryChecks` once written, so what was said is what the line reads.
//
// - The change in bulk of the screen (`BudgetLinesService.bulkUpdate`, the common contract): the dry
//   run and the write count the written rows the list's "To check" column will show (every check),
//   an account ticked or not, rows already to check, a frozen or hidden column; nothing refused.
// - Kad's card in bulk: the same count at the preview and once written, the warning while it waits
//   for an account that expects quantity and price, a limited person's own lines only.
// - Kad's cards of one line: its amounts (`write_financial_plan` upsert_amounts), a new line with its
//   amounts (`create_business_record`), its account (`update_business_record`). The warning names the
//   line's own account and says where to complete it; approval writes as before; the written card
//   does not repeat it; no warning when nothing will be to check (another account, a zero, a hidden
//   column).
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

type Column = { year: number; measure: 'planned' | 'forecast'; months: number[]; method: 'spread' | 'computed' };
type LineDef = { n: number; account: 'tick' | 'cons' | 'none'; company: 'a' | 'b'; columns: Column[] };

const spread = (year = Y): Column => ({ year, measure: 'planned', months: Array(12).fill(100), method: 'spread' });
const qp = (year = Y): Column => ({ year, measure: 'planned', months: Array(12).fill(100), method: 'computed' });

/**
 * 1, 2: spread budgets on an account that expects nothing. 3: a spread budget on the ticked account
 * (already to check). 4: as 1, paid by company B. 5: built as quantity × price on the ticked account.
 * 6: a forecast only (the column is hidden). 7: next year's budget only (frozen). 8: built as
 * quantity × price on an account ticked through its consolidation account.
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
      `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, paying_company_id, account_id, supplier_id)
       VALUES ($1, 'opex', $2, $3, 'EUR', '2020-01-01', 'enabled', $4, $5, $6) RETURNING id`,
      [tenantId, line.n, `Line ${line.n}`, companies[line.company], accounts[line.account], supplier]);
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
        await runner.query(`INSERT INTO spend_amounts (tenant_id, version_id, period, ${column.measure}) VALUES ($1, $2, make_date($3, $4, 1), $5::numeric)`,
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

async function run() {
  const harness = await createHarness();
  try {
    await testScreenBulk(harness);
    await testKadBulkCard(harness);
    await testKadBulkLimited(harness);
    await testKadLineCards(harness);
  } finally {
    await harness.app.close();
  }
  console.log('ai-budget-entry-check-warnings.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
