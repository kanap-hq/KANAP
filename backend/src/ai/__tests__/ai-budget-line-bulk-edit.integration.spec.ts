import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Lot K1 of 26.11.9: Kad changes one field on many budget lines (`bulk_update_budget_lines`), under
// a card the person approves, as the "Change the selection" of the budget lines list.
//
// - A filter of the list: the same lines as the list of the screen (its enabled lines unless the
//   filter names the status), the card in words, each line's one audit row "by Kad".
// - References (BL-n); no criterion, a field outside the dozen, an ignored or invalid filter,
//   both rows and filters: refused. Every field, an account in one chart and in several charts.
// - More than 5,000 lines refused; the list changed between the card and the approval refused.
// - A limited person: nothing outside their access counted or named, `read_only` counted.
// - A Budget Reader is not offered the tool; a right withdrawn refuses the approval.
// - A frozen year changes nothing; a frozen subscription refuses the card and the approval.
// - Another budget operation running: the tool says so, the card stays to approve and passes the
//   second time. A line held by another transaction gives up after the bounded wait.
// - A change in bulk is never a step of a mutation plan.
// - Lot K2e of 26.12.1: the card lists each line it changes (up to 200) with its value before; a
//   box leaves one out (the card recounted and replaced, the exclusion kept in the card's input), all
//   left out refused, a limited person's own lines only, 409 operation_running on a box; the list
//   never reaches the model.

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

const TOOL = 'bulk_update_budget_lines';
const LIST_CHANGED = 'The list changed since the count: count again.';
const OPERATION_RUNNING_CARD = 'Another budget operation was running for this workspace, so nothing was changed. Approve it again once it has finished.';
const DATA_BUSY_CARD = 'The data this change writes was busy with another operation, so nothing was changed. Approve it again in a moment.';
const YEAR = new Date().getFullYear();

type Harness = { app: any; dataSource: DataSource; tools: any; previews: any; budgetLines: any; policy: any; timeouts: { lockTimeoutMs: number; statementTimeoutMs: number } };
type Seed = {
  tenantId: string;
  users: Record<'member' | 'reader' | 'limited' | 'owner', string>;
  roles: Record<'member' | 'reader', string>;
  companies: { a: string; b: string };
  accounts: { a6100: string; b6100: string; a7100: string };
  suppliers: { acme: string; beta: string };
  costCenters: { it: string; fin: string };
  axis: { id: string; nord: string; sud: string };
  /** BL-1..BL-5 Acme, enabled, paid by A on account A 6100; BL-6 Beta, paid by B, no account; BL-7 Acme CAPEX paid by B; BL-8 Acme disabled. */
  lines: Record<number, string>;
  conversations: Record<string, string>;
};

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

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

async function seedUser(runner: QueryRunner, tenantId: string, roleId: string, first: string, last: string, mode: 'all' | 'limited' = 'all') {
  return one(runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, locale, data_access_mode, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, false, 'enabled', 'en', $6, now(), now()) RETURNING id`,
    [tenantId, first, last, `${first.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`, roleId, mode]);
}

async function seedGraph(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-bulk-${tag}`, `AI bulk ${tag}`],
  );
  await setTenant(runner, tenantId);
  const model = await one(runner,
    `INSERT INTO ai_model_configs (tenant_id, name, provider, model, endpoint_url, api_key_encrypted, supports_vision, is_default, created_at, updated_at)
     VALUES ($1, 'bulk-model', 'custom', 'bulk-model', 'https://llm.example.test/v1', 'test-secret', true, true, now(), now()) RETURNING id`, [tenantId]);
  await runner.query(
    `INSERT INTO ai_settings (tenant_id, chat_enabled, mcp_enabled, provider_source, llm_provider, llm_endpoint_url, llm_model,
                              llm_api_key_encrypted, web_search_enabled, glpi_enabled, chat_model_config_id, created_at, updated_at)
     VALUES ($1, true, true, 'custom', 'custom', 'https://llm.example.test/v1', 'bulk-model', 'test-secret', false, false, $2, now(), now())`,
    [tenantId, model]);
  const member = await seedRole(runner, tenantId, 'Bulk budget member', { ai_chat: 'member', budget: 'member' });
  const reader = await seedRole(runner, tenantId, 'Bulk budget reader', { ai_chat: 'member', budget: 'reader' });
  const users = {
    member: await seedUser(runner, tenantId, member, 'Member', 'Tester'),
    reader: await seedUser(runner, tenantId, reader, 'Reader', 'Tester'),
    limited: await seedUser(runner, tenantId, member, 'Limited', 'Tester', 'limited'),
    owner: await seedUser(runner, tenantId, reader, 'Julie', 'Bernard'),
  };
  const company = async (name: string) => {
    const chart = await one(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, $2, $3, 'FR') RETURNING id`, [tenantId, `C${randomUUID().slice(0, 8)}`, `Chart ${name}`]);
    const id = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, $2, 'FR', 'Lyon', $3) RETURNING id`, [tenantId, name, chart]);
    return { id, chart };
  };
  const a = await company('Company A');
  const b = await company('Company B');
  const account = (chart: string, n: number, name: string) =>
    one(runner, `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, $3, $4) RETURNING id`, [tenantId, chart, n, name]);
  const accounts = { a6100: await account(a.chart, 6100, 'Software A'), b6100: await account(b.chart, 6100, 'Software B'), a7100: await account(a.chart, 7100, 'Services A') };
  const supplier = (name: string) => one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
  const suppliers = { acme: await supplier('Acme'), beta: await supplier('Beta') };
  const center = (code: string, name: string, companyId: string) =>
    one(runner, `INSERT INTO cost_centers (tenant_id, code, kind, name, company_id, status) VALUES ($1, $2, 'cost_center', $3, $4, 'enabled') RETURNING id`, [tenantId, code, name, companyId]);
  const costCenters = { it: await center('IT-01', 'Informatique', a.id), fin: await center('FIN-02', 'Finance', b.id) };
  const axisId = await one(runner, `INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'region', 'Région') RETURNING id`, [tenantId]);
  const value = (name: string) => one(runner, `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`, [tenantId, axisId, name]);
  const axis = { id: axisId, nord: await value('Nord'), sud: await value('Sud') };
  const lines: Record<number, string> = {};
  const line = async (n: number, nature: 'opex' | 'capex', supplierId: string, companyId: string, accountId: string | null, disabled = false) => {
    lines[n] = await one(runner,
      `INSERT INTO spend_items (tenant_id, nature, product_name, currency, effective_start, item_number, supplier_id, paying_company_id, account_id, disabled_at
                                ${nature === 'capex' ? ', ppe_type, investment_type, priority' : ''})
       VALUES ($1, $2, $3, 'EUR', '2020-01-01', $4, $5, $6, $7, $8 ${nature === 'capex' ? ", 'hardware', 'replacement', 'medium'" : ''}) RETURNING id`,
      [tenantId, nature, `Line ${n}`, n, supplierId, companyId, accountId, disabled ? `${YEAR - 2}-06-30` : null]);
  };
  for (const n of [1, 2, 3, 4, 5]) await line(n, 'opex', suppliers.acme, a.id, accounts.a6100);
  await line(6, 'opex', suppliers.beta, b.id, null);
  await line(7, 'capex', suppliers.acme, b.id, null);
  await line(8, 'opex', suppliers.acme, a.id, accounts.a6100, true);
  return {
    tenantId, users, roles: { member, reader }, companies: { a: a.id, b: b.id }, accounts, suppliers, costCenters, axis, lines, conversations: {},
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

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-budget-line-bulk-edit.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { BudgetLinesService } = require('../../spend/budget-lines.service');
  const { AI_BULK_EDIT_DB_TIMEOUTS } = require('../mutation/ai-bulk-edit');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return {
    app,
    dataSource: app.get(DataSource),
    tools: app.get(AiToolRegistry),
    previews: app.get(AiMutationPreviewService),
    budgetLines: app.get(BudgetLinesService, { strict: false }),
    policy: app.get(AiPolicyService, { strict: false }),
    timeouts: AI_BULK_EDIT_DB_TIMEOUTS,
  };
}

async function ensureConversation(ctx: any) {
  await ctx.manager.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'AI bulk edit integration', 'custom', 'bulk-model', 'custom', now(), now()) ON CONFLICT (id) DO NOTHING`,
    [ctx.conversationId, ctx.tenantId, ctx.userId],
  );
}

async function card(harness: Harness, ctx: any, input: Record<string, unknown>) {
  await ensureConversation(ctx);
  const preview = await harness.tools.execute(ctx, TOOL, input) as any;
  assert.equal(preview.status, 'pending');
  assert.equal(preview.requires_confirmation, true);
  return preview;
}

async function approve(harness: Harness, ctx: any, preview: any) {
  const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
  assert.equal(executed.status, 'executed', executed.error_message || 'the card did not execute');
  return executed;
}

async function rejects(fn: () => Promise<unknown>, pattern: RegExp | string) {
  let thrown: any = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `Expected a refusal matching ${pattern}`);
  const message = thrown?.message ?? JSON.stringify(thrown?.response ?? thrown);
  if (typeof pattern === 'string') assert.equal(message, pattern);
  else assert.match(message, pattern);
  return thrown;
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

/** The card's list as the screen gets it: reference, name, value before, kept. */
function listed(preview: any): Array<[string, string, string, boolean]> {
  assert.ok(preview.bulk_edit, 'the card lists its lines');
  return preview.bulk_edit.rows.map((row: any) => [row.ref, row.title, row.before, row.kept]);
}

async function column(runner: QueryRunner, seed: Seed, n: number, name: string): Promise<string | null> {
  const [row] = await runner.query(`SELECT ${name}::text AS v FROM spend_items WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.lines[n]]);
  return row?.v ?? null;
}

async function changedLines(runner: QueryRunner, seed: Seed, name: string, value: string): Promise<number[]> {
  const rows = await runner.query(`SELECT item_number FROM spend_items WHERE tenant_id = $1 AND ${name}::text = $2 ORDER BY item_number`, [seed.tenantId, value]);
  return rows.map((row: { item_number: number }) => Number(row.item_number));
}

async function testFilterAsTheList(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'filter');
    const preview = await card(harness, ctx, { field: 'cost_center', value: 'IT-01', filters: { supplier: ['Acme'] } });
    assert.equal(preview.summary, 'Change Cost center on 6 budget lines.');
    assert.equal(preview.changes.budget_line_bulk_edit.format, 'markdown');
    assert.equal(
      preview.changes.budget_line_bulk_edit.to,
      'Filter: Supplier "Acme"\n\nScope: enabled lines\n\nCost center → IT-01 · Informatique\n\n6 lines to change',
    );
    // The card lists each line it changes, with its value before (lot K2e of 26.12.1).
    assert.deepEqual(listed(preview), [
      ['BL-1', 'Line 1', 'Empty', true], ['BL-2', 'Line 2', 'Empty', true], ['BL-3', 'Line 3', 'Empty', true],
      ['BL-4', 'Line 4', 'Empty', true], ['BL-5', 'Line 5', 'Empty', true], ['BL-7', 'Line 7', 'Empty', true],
    ]);
    assert.equal(preview.target.title, '6 budget lines');
    // The ids are the boxes' only (the list the model never reads): none elsewhere on the card.
    assert.equal(JSON.stringify({ ...preview, bulk_edit: null }).includes(seed.lines[1]), false, 'no line uuid on the card');
    assert.equal(await column(runner, seed, 1, 'cost_center_id'), null, 'the card writes nothing');
    // The same filter on the screen's list: the grid model its column sends, its enabled lines.
    const screen = await harness.budgetLines.summaryIds({ filters: { supplier_name: { filterType: 'set', values: ['Acme'] } } }, { manager: runner.manager });
    const executed = await approve(harness, ctx, preview);
    assert.equal(executed.summary, 'Cost center changed on 6 budget lines.');
    const written = await runner.query(`SELECT id::text AS id FROM spend_items WHERE tenant_id = $1 AND cost_center_id = $2`, [seed.tenantId, seed.costCenters.it]);
    assert.deepEqual(written.map((row: { id: string }) => row.id).sort(), [...screen.ids].sort(), 'the lines of the screen list, no other');
    assert.deepEqual(await changedLines(runner, seed, 'cost_center_id', seed.costCenters.it), [1, 2, 3, 4, 5, 7]);
    // One audit row per line, by Kad with the card's reference, the person as author.
    const audit = await runner.query(
      `SELECT record_id::text AS id, source, source_ref, user_id::text AS user_id FROM audit_log
        WHERE tenant_id = $1 AND action = 'update' AND record_id = ANY($2::uuid[])`,
      [seed.tenantId, Object.values(seed.lines)],
    );
    assert.equal(audit.length, 6, 'one audit row per changed line, no second row');
    assert.ok(audit.every((row: any) => row.source === 'ai_chat' && row.source_ref === preview.preview_id && row.user_id === seed.users.member));

    // The status named: the disabled line too, and no scope line.
    const all = await card(harness, context(seed, runner, 'status'), { field: 'run_build', value: 'build', filters: { supplier: ['Acme'], status: ['enabled', 'disabled'] } });
    assert.match(all.changes.budget_line_bulk_edit.to, /^Filter: Supplier "Acme"; Status "Enabled", "Disabled"\n\nRun or build → Build\n\n7 lines to change/);
    console.log('  a filter reaches the lines of the screen list, audited by Kad: OK');
  });
}

async function testReferencesAndRefusals(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'rows');
    // Beta has a contact: the line takes it, and its contacts' history row says by Kad too.
    const contact = await one(runner, `INSERT INTO contacts (tenant_id, first_name, last_name, email, item_number) VALUES ($1, 'Paul', 'Beta', 'paul@beta.test', 1) RETURNING id`, [seed.tenantId]);
    await runner.query(`INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, 'commercial')`, [seed.tenantId, seed.suppliers.beta, contact]);
    // A reference as typed (a bare number, lower case) is shown by its key.
    const preview = await card(harness, ctx, { field: 'supplier', value: 'Beta', rows: ['2', 'bl-6'] });
    assert.equal(preview.changes.budget_line_bulk_edit.to, 'Chosen lines: BL-2, BL-6\n\nSupplier → SUP-2 - Beta\n\n1 line to change, 1 already has this value');
    assert.deepEqual(listed(preview), [['BL-2', 'Line 2', 'SUP-1 - Acme', true]], 'the value before by its reference and name; the unchanged line not listed');
    await approve(harness, ctx, preview);
    assert.equal(await column(runner, seed, 2, 'supplier_id'), seed.suppliers.beta);
    const history = await runner.query(
      `SELECT table_name, source, source_ref, user_id::text AS user_id FROM audit_log WHERE tenant_id = $1 AND record_id = $2 ORDER BY table_name`,
      [seed.tenantId, seed.lines[2]],
    );
    assert.deepEqual(history.map((row: any) => row.table_name), ['spend_item_contacts', 'spend_items'], 'the line and its contacts');
    assert.ok(history.every((row: any) => row.source === 'ai_chat' && row.source_ref === preview.preview_id && row.user_id === seed.users.member),
      `every history row by Kad with the card: ${JSON.stringify(history)}`);

    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'supplier', value: 'Beta', rows: ['BL-2', 'BL-999'] }), 'No budget line BL-999 in this workspace.');
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'supplier', value: 'Beta', rows: ['APP-2'] }), '"APP-2" is not a budget line reference (BL-12).');
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'supplier', value: 'Beta', filters: {} }), /^Name the lines to change/);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'supplier', value: 'Beta', filters: { status: ['enabled'] } }), /^Name the lines to change/);
    // A part of the filter without a value is no criterion: never the whole list, never the disabled lines.
    for (const filters of [{ supplier: { not: [] } }, { supplier: [] }, { supplier: ' ' }, { supplier: ['Acme'], status: { not: [] } }, { supplier: ['Acme'], status: [] }]) {
      await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'run_build', value: 'build', filters }), /^Name the lines to change/);
    }
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'supplier', value: 'Beta', filters: { currency: ['EUR'] } }),
      /^These budget lines filters cannot choose lines to change: currency\. Use nature, status, product_name, supplier/);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'supplier', value: 'Beta', filters: { run_build: ['maybe'] } }),
      /^These budget lines filters cannot be used: run_build \(takes run, build/);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'supplier', value: 'Beta', filters: { supplier: { op: 'gt', value: 3 } } }),
      /^These budget lines filters cannot be used: supplier\./);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'supplier', value: 'Beta', rows: ['BL-1'], filters: { supplier: ['Acme'] } }), /rows|filters/);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'account', value: null, rows: ['BL-1'] }), 'The account of a budget line cannot be emptied.');
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'supplier', value: 'Beta', rows: ['BL-6'] }), /^Nothing to change/);
    await rejects(() => harness.tools.execute(ctx, 'prepare_mutation_plan', {
      operations: [{ operation_id: 'bulk', tool_name: TOOL, input: { field: 'supplier', value: 'Beta', rows: ['BL-1'] } }],
    }), /cannot be part of a mutation plan/);
    console.log('  references, refusals in words, never a plan step: OK');
  });
}

async function testEveryField(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'fields');
    // The waits of the change in bulk hold for the card only: the transaction's own come back after it
    // (the next cards of "Approve all" run in the same transaction).
    await runner.query(`SELECT set_config('lock_timeout', '7s', true), set_config('statement_timeout', '9s', true)`);
    const waits = async () => (await runner.query(`SELECT current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement`))[0];
    const first = await card(harness, ctx, { field: 'cost_center', value: 'IT-01', rows: ['BL-6'] });
    assert.deepEqual(await waits(), { lock: '7s', statement: '9s' }, 'the card puts the waits back');
    await approve(harness, ctx, first);
    assert.deepEqual(await waits(), { lock: '7s', statement: '9s' }, 'the approval puts the waits back');
    const run = async (input: Record<string, unknown>) => approve(harness, ctx, await card(harness, ctx, input));
    await run({ field: 'cost_center', value: 'FIN-02', rows: ['BL-6'] });
    assert.equal(await column(runner, seed, 6, 'cost_center_id'), seed.costCenters.fin);
    await run({ field: 'cost_center', value: null, rows: ['BL-6'] });
    assert.equal(await column(runner, seed, 6, 'cost_center_id'), null);
    await run({ field: 'paying_company', value: 'Company A', rows: ['BL-6'] });
    assert.equal(await column(runner, seed, 6, 'paying_company_id'), seed.companies.a);
    await run({ field: 'supplier', value: null, rows: ['BL-6'] });
    assert.equal(await column(runner, seed, 6, 'supplier_id'), null);
    await run({ field: 'owner_it', value: 'Julie Bernard', rows: ['BL-6'] });
    assert.equal(await column(runner, seed, 6, 'owner_it_id'), seed.users.owner);
    await run({ field: 'owner_business', value: 'Julie Bernard', rows: ['BL-6'] });
    assert.equal(await column(runner, seed, 6, 'owner_business_id'), seed.users.owner);
    await run({ field: 'run_build', value: 'Run', rows: ['BL-6'] });
    assert.equal(await column(runner, seed, 6, 'run_build'), 'run');
    const region = await card(harness, ctx, { field: 'dimension', dimension: 'Région', value: 'nord', rows: ['BL-6', 'BL-7'] });
    assert.match(region.changes.budget_line_bulk_edit.to, /\n\nRégion → Nord\n\n2 lines to change/);
    await approve(harness, ctx, region);
    const held = async () => (await runner.query(
      `SELECT category_id::text AS v FROM spend_item_analytics_values WHERE tenant_id = $1 AND item_id = $2 AND axis_id = $3`,
      [seed.tenantId, seed.lines[6], seed.axis.id],
    ))[0]?.v ?? null;
    assert.equal(await held(), seed.axis.nord);
    await run({ field: 'dimension', dimension: 'region', value: null, rows: ['BL-6'] });
    assert.equal(await held(), null);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'dimension', dimension: 'region', value: 'Ouest', rows: ['BL-6'] }), '"Ouest" is not a value of the dimension "Région".');
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'owner_it', value: 'Nobody Here', rows: ['BL-6'] }), 'No person found matching "Nobody Here".');

    // An account: 7100 is in one chart; 6100 in two, which needs the company.
    await run({ field: 'account', value: '7100', rows: ['BL-1'] });
    assert.equal(await column(runner, seed, 1, 'account_id'), seed.accounts.a7100);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'account', value: '6100', rows: ['BL-1'] }),
      /^The account "6100" is in several charts of accounts \(Chart Company A, Chart Company B\): name the company whose chart holds it \(company\)\.$/);
    // B's 6100 on a line paid by A is refused (account_chart) and counted; the line paid by B takes it.
    const account = await card(harness, ctx, { field: 'account', value: '6100', company: 'Company B', rows: ['BL-1', 'BL-7'] });
    assert.match(account.changes.budget_line_bulk_edit.to, /Account → 6100 - Software B\n\n1 line to change, 1 refused: Account outside the company's chart of accounts \(1\)$/);
    assert.deepEqual(listed(account), [['BL-7', 'Line 7', 'Empty', true]], 'the refused line counted, not listed');
    await approve(harness, ctx, account);
    assert.equal(await column(runner, seed, 7, 'account_id'), seed.accounts.b6100);
    assert.equal(await column(runner, seed, 1, 'account_id'), seed.accounts.a7100, 'the refused line is left as it is');
    // A company without a chart of accounts takes the workspace's default chart, as the screen's picker.
    const globalChart = await one(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, scope, is_global_default) VALUES ($1, 'GLOBAL', 'Chart Global', 'GLOBAL', true) RETURNING id`, [seed.tenantId]);
    const g6100 = await one(runner, `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6100, 'Software G') RETURNING id`, [seed.tenantId, globalChart]);
    const companyC = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Company C', 'FR', 'Lyon') RETURNING id`, [seed.tenantId]);
    await runner.query(`UPDATE spend_items SET paying_company_id = $2 WHERE tenant_id = $1 AND id = $3`, [seed.tenantId, companyC, seed.lines[6]]);
    const unplanned = await card(harness, ctx, { field: 'account', value: '6100', company: 'Company C', rows: ['BL-6'] });
    assert.match(unplanned.changes.budget_line_bulk_edit.to, /Account → 6100 - Software G\n/);
    assert.equal(JSON.parse(JSON.stringify((await runner.query(`SELECT mutation_input FROM ai_mutation_previews WHERE id = $1`, [unplanned.preview_id]))[0].mutation_input)).changes.account_id, g6100);
    console.log('  every field, an account in one chart and in several: OK');
  });
}

async function testCapAndListChanged(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'cap');
    await runner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, supplier_id)
       SELECT $1, 'Mass ' || n, 'EUR', '2020-01-01', 1000 + n, $2 FROM generate_series(1, 5001) AS n`,
      [seed.tenantId, seed.suppliers.beta],
    );
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'run_build', value: 'run', filters: { supplier: ['Beta'] } }),
      'These filters reach 5002 rows, more than 5000 at once: narrow them.');

    // The list changes between the card and its approval: a line leaves the filter.
    const changed = context(seed, runner, 'changed');
    const preview = await card(harness, changed, { field: 'run_build', value: 'build', filters: { supplier: ['Acme'] } });
    await runner.query(`UPDATE spend_items SET supplier_id = $2 WHERE tenant_id = $1 AND id = $3`, [seed.tenantId, seed.suppliers.beta, seed.lines[3]]);
    const failed = await harness.previews.executePreview(changed, preview.preview_id) as any;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error_message, LIST_CHANGED);
    assert.deepEqual(await changedLines(runner, seed, 'run_build', 'build'), [], 'nothing written');
    console.log('  more than 5,000 lines and a list that changed are refused: OK');
  });
}

async function testLimitedPerson(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    if (!(await runner.query(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`))[0].present) {
      if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
      console.log('  skip - kanap_data_limited not installed');
      return;
    }
    // Company A in edit, company B in read: BL-6 and BL-7 (B) read only; BL-8 disabled; no line hidden yet,
    // so one Acme line moves to no company, out of the access.
    await runner.query(`INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access) VALUES ($1, $2, 'company', $3, 'edit'), ($1, $2, 'company', $4, 'read')`,
      [seed.tenantId, seed.users.limited, seed.companies.a, seed.companies.b]);
    await runner.query(`UPDATE spend_items SET paying_company_id = NULL, account_id = NULL WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.lines[1]]);
    const ctx = context(seed, runner, 'limited', seed.users.limited);
    await ensureConversation(ctx);
    assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [seed.users.limited]))[0].mode, 'limited');
    const preview = await card(harness, ctx, { field: 'run_build', value: 'build', filters: { supplier: ['Acme'] } });
    assert.equal(
      preview.changes.budget_line_bulk_edit.to,
      'Filter: Supplier "Acme"\n\nScope: enabled lines\n\nRun or build → Build\n\n4 lines to change, 1 refused: Read only for you (1)',
    );
    // Its own lines only, listed; the read-only line counted with its reason, without a box.
    assert.deepEqual(listed(preview), [['BL-2', 'Line 2', 'Empty', true], ['BL-3', 'Line 3', 'Empty', true], ['BL-4', 'Line 4', 'Empty', true], ['BL-5', 'Line 5', 'Empty', true]]);
    for (const outside of ['Line 1', 'Line 7', seed.lines[1], seed.lines[7]]) assert.equal(JSON.stringify(preview).includes(outside), false, `${outside} never on the card`);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'run_build', value: 'build', rows: ['BL-1'] }), 'No budget line BL-1 in this workspace.');
    await approve(harness, ctx, preview);
    // Read back as the person: the lines of the access changed, the read-only lines left as they are.
    assert.deepEqual(await changedLines(runner, seed, 'run_build', 'build'), [2, 3, 4, 5], 'only the lines of the access');
    assert.equal(await column(runner, seed, 7, 'run_build'), null, 'the read-only line is left as it is');
    console.log('  a limited person: nothing outside the access counted or named, read only counted: OK');
  });
}

async function testRightsFreezeAndSubscription(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const readerCtx = context(seed, runner, 'reader', seed.users.reader);
    const offered = await harness.tools.listAvailableTools(readerCtx) as Array<{ name: string }>;
    assert.ok(!offered.some((tool) => tool.name === TOOL), 'a Budget Reader is not offered the tool');
    await rejects(() => harness.tools.execute(readerCtx, TOOL, { field: 'run_build', value: 'run', rows: ['BL-1'] }), 'AI tool is not available.');
    const ctx = context(seed, runner, 'rights');
    assert.ok((await harness.tools.listAvailableTools(ctx) as Array<{ name: string }>).some((tool) => tool.name === TOOL), 'a Budget Member is');

    // A frozen year changes nothing: no amount moves.
    await runner.query(`INSERT INTO freeze_states (tenant_id, budget_year, scope, column_key, is_frozen) VALUES ($1, $2, 'opex', 'budget', true), ($1, $2, 'capex', 'budget', true)`, [seed.tenantId, YEAR]);
    const frozen = await card(harness, ctx, { field: 'cost_center', value: 'IT-01', rows: ['BL-1', 'BL-7'] });
    assert.match(frozen.changes.budget_line_bulk_edit.to, /\n\n2 lines to change$/);
    await approve(harness, ctx, frozen);

    // The right withdrawn before the approval.
    const preview = await card(harness, ctx, { field: 'run_build', value: 'run', rows: ['BL-1'] });
    await runner.query(`UPDATE role_permissions SET level = 'reader' WHERE tenant_id = $1 AND role_id = $2 AND resource = 'budget'`, [seed.tenantId, seed.roles.member]);
    await rejects(() => harness.previews.executePreview(ctx, preview.preview_id), /budget/i);
    assert.equal(await column(runner, seed, 1, 'run_build'), null, 'the refused approval wrote nothing');
    await runner.query(`UPDATE role_permissions SET level = 'member' WHERE tenant_id = $1 AND role_id = $2 AND resource = 'budget'`, [seed.tenantId, seed.roles.member]);

    // A frozen subscription (cloud billing configured, past due beyond its grace): the real check.
    const pending = await card(harness, ctx, { field: 'run_build', value: 'build', rows: ['BL-2'] });
    await runner.query(
      `INSERT INTO subscriptions (tenant_id, status, stripe_subscription_id, stripe_customer_id, plan_name, seat_limit, active_seats,
                                  collection_method, latest_invoice_status, latest_invoice_created)
       VALUES ($1, 'past_due', $2, $3, 'Kadratis Cloud', NULL, 1, 'charge_automatically', 'open', now() - interval '60 days')`,
      [seed.tenantId, `sub_${seed.tenantId.slice(0, 8)}`, `cus_${seed.tenantId.slice(0, 8)}`],
    );
    const stripe = harness.policy.stripeConfig;
    const configured = stripe.isConfigured;
    stripe.isConfigured = () => true;
    try {
      const refusal = (error: any) => error?.getResponse?.()?.error === 'SUBSCRIPTION_FROZEN';
      await assert.rejects(harness.tools.execute(ctx, TOOL, { field: 'run_build', value: 'run', rows: ['BL-3'] }), refusal);
      await assert.rejects(harness.previews.executePreview(ctx, pending.preview_id), refusal);
    } finally {
      stripe.isConfigured = configured;
    }
    assert.equal(await column(runner, seed, 2, 'run_build'), null, 'nothing written while frozen');
    console.log('  reader, right withdrawn, frozen year, frozen subscription: OK');
  });
}

/**
 * One step of the chat in its own transaction, committed, as each tool call and each approval
 * runs (`AiTenantExecutionService.runWithContext`). A refused step is rolled back.
 */
async function step<T>(harness: Harness, seed: Seed, label: string, fn: (ctx: any) => Promise<T>): Promise<T> {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    await setTenant(runner, seed.tenantId);
    const ctx = context(seed, runner, label);
    await ensureConversation(ctx);
    const result = await fn(ctx);
    await runner.commitTransaction();
    return result;
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

async function committedColumn(harness: Harness, seed: Seed, n: number, name: string) {
  return step(harness, seed, 'read', async (ctx) => (await ctx.manager.query(
    `SELECT ${name}::text AS v FROM spend_items WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.lines[n]],
  ))[0]?.v ?? null);
}

/**
 * Another budget operation, then a line held by another transaction. The rows are committed (a
 * tenant deleted after) so that another connection holds the lock or the line, as in production.
 */
async function testOperationRunningAndHeldLine(harness: Harness) {
  const seeding = harness.dataSource.createQueryRunner();
  await seeding.connect();
  await seeding.startTransaction();
  const seed = await seedGraph(seeding);
  await seeding.commitTransaction();
  await seeding.release();
  const saved = { ...harness.timeouts };
  const other = harness.dataSource.createQueryRunner();
  await other.connect();
  try {
    // Another budget operation runs: the tool says so; the card stays to approve and passes the second time.
    const first = await step(harness, seed, 'running', (ctx) => card(harness, ctx, { field: 'run_build', value: 'build', rows: ['BL-1', 'BL-2'] }));
    await other.query(`SELECT pg_advisory_lock($1::int, hashtext($2))`, [0x424f5053, `budget-ops:${seed.tenantId}`]);
    await rejects(() => step(harness, seed, 'running', (ctx) => harness.tools.execute(ctx, TOOL, { field: 'run_build', value: 'run', rows: ['BL-3'] })),
      /^Another budget operation .* Try again when it has finished\.$/);
    const waiting = await step(harness, seed, 'running', (ctx) => harness.previews.executePreview(ctx, first.preview_id)) as any;
    assert.equal(waiting.status, 'pending', 'the card stays to approve');
    assert.equal(waiting.error_message, OPERATION_RUNNING_CARD);
    assert.equal(await committedColumn(harness, seed, 1, 'run_build'), null);
    await other.query(`SELECT pg_advisory_unlock_all()`);
    await step(harness, seed, 'running', (ctx) => approve(harness, ctx, first));
    assert.equal(await committedColumn(harness, seed, 2, 'run_build'), 'build', 'the second approval passes');
    console.log('  another budget operation: the tool says so, the card passes the second time: OK');

    // A box changed while another budget operation runs (lot K2e of 26.12.1): 409 operation_running,
    // the card left as it was; once the operation ends, the same box passes.
    const boxes = await step(harness, seed, 'running-boxes', (ctx) => card(harness, ctx, { field: 'run_build', value: 'build', rows: ['BL-3', 'BL-4'] }));
    await other.query(`SELECT pg_advisory_lock($1::int, hashtext($2))`, [0x424f5053, `budget-ops:${seed.tenantId}`]);
    const busy = await rejects(() => step(harness, seed, 'running-boxes', (ctx) => exclude(harness, ctx, boxes, [seed.lines[4]])), /^Another budget operation /);
    assert.equal(busy.getStatus(), 409);
    assert.equal(busy.getResponse().code, 'operation_running', 'the screen reads it as "try again"');
    const unchanged = await step(harness, seed, 'running-boxes', (ctx) => previewRow(ctx.manager, seed.tenantId, boxes.preview_id));
    assert.equal(unchanged.status, 'pending', 'the card stays as it was');
    assert.equal(unchanged.mutation_input.excluded, undefined);
    await other.query(`SELECT pg_advisory_unlock_all()`);
    const left = await step(harness, seed, 'running-boxes', (ctx) => exclude(harness, ctx, boxes, [seed.lines[4]]));
    await step(harness, seed, 'running-boxes', (ctx) => approve(harness, ctx, left));
    assert.equal(await committedColumn(harness, seed, 3, 'run_build'), 'build');
    assert.equal(await committedColumn(harness, seed, 4, 'run_build'), null, 'the line left out is left as it is');
    console.log('  a box while another budget operation runs: 409 operation_running, the card as it was: OK');

    // A line held by another transaction: the tool and the approval give up after the bounded wait.
    harness.timeouts.lockTimeoutMs = 300;
    const second = await step(harness, seed, 'held', (ctx) => card(harness, ctx, { field: 'run_build', value: 'run', rows: ['BL-1'] }));
    await other.startTransaction();
    await setTenant(other, seed.tenantId);
    await other.query(`SELECT id FROM spend_items WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [seed.tenantId, seed.lines[1]]);
    const started = Date.now();
    await rejects(() => step(harness, seed, 'held', (ctx) => harness.tools.execute(ctx, TOOL, { field: 'run_build', value: 'run', rows: ['BL-1'] })),
      /busy|lock/i);
    const held = await step(harness, seed, 'held', (ctx) => harness.previews.executePreview(ctx, second.preview_id)) as any;
    assert.ok(Date.now() - started < 10_000, 'the turn gives up after the bounded wait');
    assert.equal(held.status, 'pending', 'the card stays to approve');
    assert.equal(held.error_message, DATA_BUSY_CARD);
    await other.rollbackTransaction();
    await step(harness, seed, 'held', (ctx) => approve(harness, ctx, second));
    assert.equal(await committedColumn(harness, seed, 1, 'run_build'), 'run');
    console.log('  a line held elsewhere: the bounded wait, the card stays to approve: OK');
  } finally {
    Object.assign(harness.timeouts, saved);
    if (other.isTransactionActive) await other.rollbackTransaction();
    await other.query(`SELECT pg_advisory_unlock_all()`);
    await other.release();
    await dropTenant(harness, seed.tenantId);
  }
}

/** The route of the card's boxes (lot K2e of 26.12.1), as the screen calls it: the whole list of the ids left out. */
async function exclude(harness: Harness, ctx: any, preview: any, excluded: unknown) {
  const { AiImportFileController } = require('../import/ai-import-file.controller');
  const controller = harness.app.get(AiImportFileController);
  return controller.exclude(ctx.conversationId, preview.preview_id, { excluded }, { user: { sub: ctx.userId }, headers: {} }, { tenantId: ctx.tenantId, manager: ctx.manager }) as Promise<any>;
}

async function previewRow(manager: any, tenantId: string, id: string) {
  const [row] = await manager.query(
    `SELECT id::text AS id, status, mutation_input, current_values FROM ai_mutation_previews WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return row;
}

/**
 * The card lists each line it changes (lot K2e of 26.12.1): a box leaves one out, the card is
 * recounted and replaced; the approval writes only those kept, each
 * audited by Kad; the list stays, the changed lines marked. The list never reaches the model.
 */
async function testLeaveOutAndApprove(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'leave-out');
    await ensureConversation(ctx);
    const { AiCapabilityDispatcherService } = require('../control-plane/dispatcher/ai-capability-dispatcher.service');
    const dispatched = await harness.app.get(AiCapabilityDispatcherService).execute(ctx, {
      capabilityName: TOOL,
      input: { field: 'supplier', value: 'Beta', rows: ['BL-1', 'BL-2', 'BL-3'] },
      execution: { surface: 'chat', trigger_kind: 'human_user' },
    }) as any;
    // The tool message carries the counts; the list is the screen's.
    assert.equal(dispatched.output.bulk_edit, '[REDACTED]');
    for (const word of ['Line 1', 'Line 2', 'SUP-1', 'Acme', seed.lines[1], seed.lines[2]]) {
      assert.equal(JSON.stringify(dispatched.output).includes(word), false, `the model never reads ${word}`);
    }
    const first = dispatched.previews[0];
    assert.deepEqual(listed(first), [['BL-1', 'Line 1', 'SUP-1 - Acme', true], ['BL-2', 'Line 2', 'SUP-1 - Acme', true], ['BL-3', 'Line 3', 'SUP-1 - Acme', true]]);

    const second = await exclude(harness, ctx, first, [seed.lines[2]]);
    assert.equal(second.replaces_preview_id, first.preview_id);
    assert.equal((await previewRow(runner.manager, seed.tenantId, first.preview_id)).status, 'expired');
    assert.deepEqual(listed(second).map((row) => [row[0], row[3]]), [['BL-1', true], ['BL-2', false], ['BL-3', true]]);
    assert.equal(second.changes.budget_line_bulk_edit.to, 'Chosen lines: BL-1, BL-2, BL-3\n\nSupplier → SUP-2 - Beta\n\n2 lines to change, 1 left out');
    const stored = await previewRow(runner.manager, seed.tenantId, second.preview_id);
    assert.deepEqual(stored.mutation_input.excluded, [seed.lines[2]]);
    const { AiActionRequestService } = require('../control-plane/action-request/ai-action-request.service');
    const actions = harness.app.get(AiActionRequestService);
    const { excluded: _left, ...without } = stored.mutation_input;
    assert.notEqual(actions.inputHashForPreview(stored), actions.inputHashForPreview({ ...stored, mutation_input: without }), 'the card\'s input names the exclusion');

    const executed = await approve(harness, ctx, second);
    assert.equal(executed.summary, 'Supplier changed on 2 budget lines.');
    assert.equal(await column(runner, seed, 1, 'supplier_id'), seed.suppliers.beta);
    assert.equal(await column(runner, seed, 2, 'supplier_id'), seed.suppliers.acme, 'the line left out is left as it is');
    assert.equal(await column(runner, seed, 3, 'supplier_id'), seed.suppliers.beta);
    const audit = await runner.query(
      `SELECT record_id::text AS id, source_ref FROM audit_log WHERE tenant_id = $1 AND table_name = 'spend_items' AND action = 'update' AND record_id = ANY($2::uuid[])`,
      [seed.tenantId, Object.values(seed.lines)],
    );
    assert.deepEqual(audit.map((row: any) => row.id).sort(), [seed.lines[1], seed.lines[3]].sort(), 'audited: the kept lines only');
    assert.ok(audit.every((row: any) => row.source_ref === second.preview_id));
    assert.deepEqual(executed.bulk_edit.rows.map((row: any) => [row.ref, row.kept, row.changed]), [['BL-1', true, true], ['BL-2', false, false], ['BL-3', true, true]]);
    await rejects(() => exclude(harness, ctx, second, []), /no longer be changed/);

    // Every line left out: the approval refused, nothing written; a foreign id refused.
    const other = await card(harness, ctx, { field: 'run_build', value: 'run', rows: ['BL-4', 'BL-5'] });
    await rejects(() => exclude(harness, ctx, other, [seed.lines[6]]), 'Only a line this card lists can be left out.');
    const none = await exclude(harness, ctx, other, [seed.lines[4], seed.lines[5]]);
    // The card says why it cannot be approved before any approval: the screen greys Approve out.
    assert.equal(none.error_message, 'Every record of this card is left out: there is nothing to approve.');
    const refused = await harness.previews.executePreview(ctx, none.preview_id) as any;
    assert.equal(refused.status, 'pending');
    assert.equal(refused.error_message, 'Every record of this card is left out: there is nothing to approve.');
    assert.deepEqual(await changedLines(runner, seed, 'run_build', 'run'), [], 'nothing written');
    console.log('  a box leaves a line out, the approval writes the kept ones only, the model reads no list: OK');
  });
}

/** A limited person leaves one of their lines out; a line outside the access (counted read only) has no box. */
async function testLimitedPersonLeavesOut(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    if (!(await runner.query(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`))[0].present) {
      if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
      console.log('  skip - kanap_data_limited not installed');
      return;
    }
    await runner.query(`INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access) VALUES ($1, $2, 'company', $3, 'edit'), ($1, $2, 'company', $4, 'read')`,
      [seed.tenantId, seed.users.limited, seed.companies.a, seed.companies.b]);
    const ctx = context(seed, runner, 'limited-leave-out', seed.users.limited);
    await ensureConversation(ctx);
    assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [seed.users.limited]))[0].mode, 'limited');
    const preview = await card(harness, ctx, { field: 'run_build', value: 'build', filters: { supplier: ['Acme'] } });
    assert.match(preview.changes.budget_line_bulk_edit.to, /\n\n5 lines to change, 1 refused: Read only for you \(1\)$/);
    assert.deepEqual(listed(preview).map((row) => row[0]), ['BL-1', 'BL-2', 'BL-3', 'BL-4', 'BL-5'], 'its own lines only; the read-only line has no box');
    await rejects(() => exclude(harness, ctx, preview, [seed.lines[7]]), 'Only a line this card lists can be left out.');
    const kept = await exclude(harness, ctx, preview, [seed.lines[3]]);
    assert.match(kept.changes.budget_line_bulk_edit.to, /\n\n4 lines to change, 1 left out, 1 refused: Read only for you \(1\)$/);
    assert.deepEqual(listed(kept).map((row) => [row[0], row[3]]), [['BL-1', true], ['BL-2', true], ['BL-3', false], ['BL-4', true], ['BL-5', true]]);
    assert.equal(JSON.stringify(kept).includes('Line 7'), false, 'the line outside the access is never named');
    await approve(harness, ctx, kept);
    assert.deepEqual(await changedLines(runner, seed, 'run_build', 'build'), [1, 2, 4, 5], 'the kept lines of the access only');
    assert.equal(await column(runner, seed, 3, 'run_build'), null, 'the line left out is left as it is');
    console.log('  a limited person: its own lines listed, one left out, the read-only line counted without a box: OK');
  });
}

/**
 * The approval writes no line the card did not list (review of lot K2e): BL-7, counted read only for a
 * limited person (no box), made editable before the approval, would be written; the whole write is
 * refused.
 */
async function testUnlistedLineNeverWritten(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    if (!(await runner.query(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`))[0].present) {
      if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
      console.log('  skip - kanap_data_limited not installed');
      return;
    }
    await runner.query(`INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access) VALUES ($1, $2, 'company', $3, 'edit'), ($1, $2, 'company', $4, 'read')`,
      [seed.tenantId, seed.users.limited, seed.companies.a, seed.companies.b]);
    const ctx = context(seed, runner, 'unlisted', seed.users.limited);
    await ensureConversation(ctx);
    assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [seed.users.limited]))[0].mode, 'limited');
    const preview = await card(harness, ctx, { field: 'run_build', value: 'build', filters: { supplier: ['Acme'] } });
    assert.match(preview.changes.budget_line_bulk_edit.to, /\n\n5 lines to change, 1 refused: Read only for you \(1\)$/);
    assert.equal(listed(preview).some((row) => row[0] === 'BL-7'), false, 'the read-only line is not listed');
    // Company B goes to edit before the approval: BL-7 becomes editable.
    await runner.query('RESET ROLE');
    await runner.query(`UPDATE user_data_access_nodes SET access = 'edit' WHERE tenant_id = $1 AND user_id = $2 AND company_id = $3`, [seed.tenantId, seed.users.limited, seed.companies.b]);
    assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [seed.users.limited]))[0].mode, 'limited');
    const refused = await harness.previews.executePreview(ctx, preview.preview_id) as any;
    assert.equal(refused.status, 'failed');
    assert.equal(refused.error_message, LIST_CHANGED);
    assert.deepEqual(await changedLines(runner, seed, 'run_build', 'build'), [], 'nothing written, the line never listed included');
    console.log('  a line counted read only, made editable before the approval, refuses it: OK');
  });
}

/** Up to 200 lines listed; beyond, the count and five examples, and the model is told to offer narrowing. */
async function testListUpTo200(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    await runner.query(
      `INSERT INTO spend_items (tenant_id, nature, product_name, currency, effective_start, item_number, supplier_id)
       SELECT $1, 'opex', 'Mass ' || n, 'EUR', '2020-01-01', 1000 + n, $2 FROM generate_series(1, 199) AS n`,
      [seed.tenantId, seed.suppliers.beta],
    );
    const ctx = context(seed, runner, 'two-hundred');
    const listedCard = await card(harness, ctx, { field: 'run_build', value: 'run', filters: { supplier: ['Beta'] } });
    assert.equal(listedCard.bulk_edit.rows.length, 200, '200 lines listed');
    assert.equal(listedCard.assistant_note, undefined);
    await runner.query(`INSERT INTO spend_items (tenant_id, nature, product_name, currency, effective_start, item_number, supplier_id) VALUES ($1, 'opex', 'Mass 200', 'EUR', '2020-01-01', 1200, $2)`,
      [seed.tenantId, seed.suppliers.beta]);
    const counted = await card(harness, ctx, { field: 'run_build', value: 'run', filters: { supplier: ['Beta'] } });
    assert.equal(counted.bulk_edit, undefined, '201: counted, not listed');
    assert.match(counted.changes.budget_line_bulk_edit.to, /\n\n201 lines to change\n\n- BL-6 Line 6\n- BL-1001 Mass 1\n/);
    assert.match(counted.assistant_note, /^This card changes 201 budget lines: more than 200, so it counts them without listing them.*narrow/);
    await rejects(() => exclude(harness, ctx, counted, [seed.lines[6]]), 'This card does not list its lines: none can be left out.');

    // A card of 200 recounted past 200 (a line entered the filter since): refused, the card as it was (review of lot K2e).
    await runner.query(`UPDATE ai_mutation_previews SET status = 'rejected' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, counted.preview_id]);
    await runner.query(`UPDATE spend_items SET disabled_at = '2000-01-01' WHERE tenant_id = $1 AND item_number = 1200`, [seed.tenantId]);
    const two = await card(harness, ctx, { field: 'run_build', value: 'run', filters: { supplier: ['Beta'] } });
    assert.equal(two.bulk_edit.rows.length, 200);
    await runner.query(`UPDATE spend_items SET disabled_at = NULL WHERE tenant_id = $1 AND item_number = 1200`, [seed.tenantId]);
    const grown = await rejects(() => exclude(harness, ctx, two, [seed.lines[6]]), /^The selection grew past 200 records since the count: ask for a new card\.$/);
    assert.deepEqual([grown.getStatus(), grown.getResponse().code], [409, 'bulk_list_grew']);
    assert.equal((await previewRow(runner.manager, seed.tenantId, two.preview_id)).status, 'pending', 'the card stays as it was');
    console.log('  200 lines listed, 201 counted with five examples and a note to narrow, a recount past 200 refused: OK');
  });
}

/** Deletes a committed test tenant: every table with a tenant_id, in passes until the keys allow it. */
async function dropTenant(harness: Harness, tenantId: string) {
  const tables: string[] = (await harness.dataSource.query(
    `SELECT c.relname AS name FROM pg_class c
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace AND c.relname <> 'tenants'`,
  )).map((row: { name: string }) => row.name);
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    await setTenant(runner, tenantId);
    let left = tables;
    for (let pass = 0; pass < 8 && left.length > 0; pass++) {
      const failed: string[] = [];
      for (const table of left) {
        await runner.query('SAVEPOINT drop_tenant');
        try {
          await runner.query(`DELETE FROM "${table}" WHERE tenant_id = $1`, [tenantId]);
          await runner.query('RELEASE SAVEPOINT drop_tenant');
        } catch {
          await runner.query('ROLLBACK TO SAVEPOINT drop_tenant');
          failed.push(table);
        }
      }
      left = failed;
    }
    await runner.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await runner.commitTransaction();
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

async function run() {
  const harness = await createHarness();
  try {
    await testFilterAsTheList(harness);
    await testReferencesAndRefusals(harness);
    await testEveryField(harness);
    await testCapAndListChanged(harness);
    await testLimitedPerson(harness);
    await testRightsFreezeAndSubscription(harness);
    await testOperationRunningAndHeldLine(harness);
    await testLeaveOutAndApprove(harness);
    await testLimitedPersonLeavesOut(harness);
    await testUnlistedLineNeverWritten(harness);
    await testListUpTo200(harness);
  } finally {
    await harness.app.close();
  }
  console.log('ai-budget-line-bulk-edit.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
