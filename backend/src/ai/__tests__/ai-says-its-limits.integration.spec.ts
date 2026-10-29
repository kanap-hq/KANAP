import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { addMonthsYmd } from '../../contracts/contract-terms';

// Plaid and the MCP server say their limits (lot "Plaid dit ses limites", quality pass of
// 2026-10-26). Each check replays a question of the pass on the tools and reads the tool answer:
//
// - P5 q4: query_entities on budget lines gives `amount_totals`, the amounts of every line the
//   filters keep (all pages), with the currency, and `page_amount_totals`, those of the page
//   returned (the ten largest lines and their total); the same for contracts, per currency.
// - P2 q10b, q12, q20: search_all names the families it does not read (cost centers, data access,
//   chargeback) when the words ask for them, and all of them when nothing matched;
//   describe_entity_filters lists them. Their screens come in the person's language (profile),
//   in the four languages when the profile sets none (essay of 2026-10-27).
// - P3 q27: get_entity_context of an application carries RTO, RPO, recovery wave, last recovery
//   test and end of support, and says the context is an extract (`fields_note`).
// - P3-7: a value outside a closed set (`status: active` for `enabled`) is refused with
//   `invalid_filter_value` and the accepted values, on query_entities and aggregate_entities.
// - B9 / P4-8: in a limited transaction, budget lists and aggregates say `data_access` limited.
// - P4-9: a missing right is refused in plain words, without its code.
// - P3-16: the application detail gives the labels and ranks of its classifications.
// - L1 check: a contract's detail and context give the number of its current term.
// The AI surface checks are not under test: stubbed open.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-says-its-limits-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; executor: any; aggregates: any; entities: any; tools: any };
type UserKey = 'full' | 'appsOnly' | 'reporter';
type Seed = { tenantId: string; users: Record<UserKey, string>; contract: string };

const YEAR = new Date().getFullYear();
/** The budgets of the seeded OPEX lines, this year. */
const BUDGETS = [650000, 420000, 280000, 213640, 211996.78, 210000, 209280, 204920, 200839.05, 191840, 191840, 1000];

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-says-its-limits.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { AiEntityService } = require('../ai-entity.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  return {
    app,
    dataSource: app.get(DataSource),
    executor: app.get(AiQueryExecutor),
    aggregates: app.get(AiAggregateExecutor),
    entities: app.get(AiEntityService),
    tools: app.get(AiToolRegistry),
  };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-limits-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const role = async (name: string, resources: string[]) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, name]);
    for (const resource of resources) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'reader')`, [tenantId, id, resource]);
    }
    return id;
  };
  const user = async (key: string, roleId: string) => insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled')`,
    [tenantId, `${key}-${slug}@example.test`, key, roleId]);
  const users = {
    full: await user('Full', await role('Readers', ['applications', 'budget', 'contracts', 'portfolio_projects'])),
    appsOnly: await user('Apps', await role('Applications only', ['applications'])),
    reporter: await user('Reporter', await role('Report readers', ['budget', 'reporting'])),
  };

  // P3 q27: APP-8 with its recovery objectives, as on the demo tenant.
  await runner.query(
    `INSERT INTO applications (tenant_id, name, sequential_id, status, criticality, cyber_criticality, recovery_wave, rto_minutes, rpo_minutes, last_dr_test, end_of_support_date)
     VALUES ($1, 'SAP S/4HANA', 'APP-8', 'enabled', 'business_critical', 'critical', 'vital', 180, 15, '2026-03-14', '2030-12-31')`,
    [tenantId],
  );

  // P5 q4: twelve OPEX lines with a budget this year, more than a page of ten.
  for (const [index, budget] of BUDGETS.entries()) {
    const itemId = await insertId(runner,
      `INSERT INTO spend_items (tenant_id, item_number, product_name, currency, effective_start, status) VALUES ($1, $2, $3, 'EUR', '2020-01-01', 'enabled')`,
      [tenantId, index + 1, `Line ${index + 1}`]);
    const versionId = await insertId(runner,
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
       VALUES ($1, $2, 'Budget', 'monthly', make_date($3, 1, 1), $3, 'default')`,
      [tenantId, itemId, YEAR]);
    await runner.query(`INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, make_date($3, 1, 1), $4::numeric)`, [tenantId, versionId, YEAR, budget]);
  }

  // Contracts: one in its second term, in EUR, and one in USD.
  const company = await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Company', 'FR', 'Paris')`, [tenantId]);
  const supplier = await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Supplier')`, [tenantId]);
  const today = new Date().toISOString().slice(0, 10);
  const contract = await insertId(runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, notice_period_months, auto_renewal, currency, yearly_amount_at_signature)
     VALUES ($1, 'Second term', $2, $3, $4, 12, 1, true, 'EUR', 1200)`,
    [tenantId, company, supplier, addMonthsYmd(today, -14)]);
  await runner.query(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, notice_period_months, auto_renewal, currency, yearly_amount_at_signature)
     VALUES ($1, 'Dollars', $2, $3, $4, 12, 1, true, 'USD', 500)`,
    [tenantId, company, supplier, addMonthsYmd(today, -2)]);
  return { tenantId, users, contract };
}

function ctx(runner: QueryRunner, s: Seed, user: UserKey, surface: 'chat' | 'mcp' = 'mcp') {
  return { tenantId: s.tenantId, userId: s.users[user], isPlatformHost: false, surface, authMethod: 'api_key' as const, manager: runner.manager };
}

const cents = (value: number) => Math.round(value * 100);

async function testTotals(h: Harness, runner: QueryRunner, s: Seed) {
  const full = ctx(runner, s, 'full');
  // The top 10 of the pass: one page of ten, the totals of the twelve lines.
  const page = await h.tools.execute(full, 'query_entities', { entity_type: 'budget_lines', limit: 10, sort: { field: 'y_budget', direction: 'desc' } });
  assert.equal(page.total, BUDGETS.length);
  assert.equal(page.returned, 10, 'one page of ten');
  const totals = page.amount_totals;
  assert.ok(totals, 'amount_totals on budget lines');
  assert.equal(totals.records, BUDGETS.length);
  assert.equal(totals.currency, 'EUR', 'the reporting currency');
  assert.equal(cents(totals.values.y_budget), cents(BUDGETS.reduce((sum, value) => sum + value, 0)), 'every line, not only the page');
  assert.match(totals.note, /never added up/);
  // The ten largest lines and their total: the page's own total, with the tie at the tenth place
  // (191,840 twice) left to the page (the essay of 2026-10-27 gave the total of eleven lines).
  const pageTotals = page.page_amount_totals;
  assert.ok(pageTotals, 'page_amount_totals on budget lines');
  assert.equal(pageTotals.records, 10);
  assert.equal(pageTotals.currency, totals.currency, 'the same currency');
  assert.deepEqual(Object.keys(pageTotals.values).sort(), Object.keys(totals.values).sort(), 'the same fields');
  const topTen = page.items.map((item: any) => Number(item.metadata.y_budget));
  assert.deepEqual(topTen.map(cents), BUDGETS.slice(0, 10).map(cents), 'the ten largest, in order');
  assert.equal(cents(pageTotals.values.y_budget), cents(topTen.reduce((sum: number, value: number) => sum + value, 0)), 'the sum of the ten');
  assert.equal(cents(pageTotals.values.y_budget), cents(2792515.83));
  assert.match(pageTotals.note, /returned on this page only/);
  const secondPage = await h.tools.execute(full, 'query_entities', { entity_type: 'budget_lines', limit: 10, page: 2, sort: { field: 'y_budget', direction: 'desc' } });
  assert.equal(cents(secondPage.page_amount_totals.values.y_budget), cents(191840 + 1000), 'the second page: its two lines');
  const aggregate = await h.tools.execute(full, 'aggregate_entities', { entity_type: 'budget_lines', group_by: 'status', metric: 'y_budget', function: 'sum' });
  assert.equal(cents(aggregate.groups.reduce((sum: number, group: any) => sum + Number(group.value), 0)), cents(totals.values.y_budget), 'the aggregate of the same lines');
  // A filtered selection: its own total.
  const filtered = await h.tools.execute(full, 'query_entities', { entity_type: 'budget_lines', filters: { y_budget: { op: 'lt', value: 200000 } } });
  assert.equal(cents(filtered.amount_totals.values.y_budget), cents(191840 + 191840 + 1000), 'the filtered lines only');

  const contracts = await h.tools.execute(full, 'query_entities', { entity_type: 'contracts', limit: 1 });
  assert.deepEqual(
    contracts.amount_totals.by_currency.map((row: any) => [row.currency, row.yearly_amount, row.contracts]),
    [['EUR', 1200, 1], ['USD', 500, 1]],
    'contracts: per currency, every page',
  );
  assert.equal(contracts.returned, 1);
  assert.equal(contracts.page_amount_totals.records, 1);
  assert.equal(contracts.page_amount_totals.by_currency.length, 1, 'contracts: the page only');
  assert.equal(contracts.page_amount_totals.by_currency[0].contracts, 1);
  console.log('  P5 q4: amount_totals on budget lines and contracts: OK');
}

async function testUnreadFamilies(h: Harness, runner: QueryRunner, s: Seed) {
  const full = ctx(runner, s, 'full');
  // P2 q10b: the model searched the code alone.
  const code = await h.tools.execute(full, 'search_all', { query: 'FR-TRV-600' });
  assert.equal(code.items.length, 0);
  // The profile sets no language: the screens in the four languages of the menus.
  assert.ok(code.families_not_read.some((line: string) => line.startsWith('cost centers (en: Master data › Cost centers; fr: Données de référence › Centres de coûts;')), 'no match: the unread families, cost centers first');
  assert.match(code.no_match_note, /may exist/);
  const named = await h.tools.execute(full, 'search_all', { query: 'centre de coûts FR-TRV-600' });
  assert.equal(named.not_read_here[0].family, 'cost centers');
  assert.match(named.not_read_here[0].note, /^KANAP has cost centers; this server does not read them\. They are on the screen named, in the person's language, en: Master data › Cost centers; fr: Données de référence › Centres de coûts;/);

  // A French profile: the screens as the French menus name them (P2 q10b, q12, q20).
  await runner.query(`UPDATE users SET locale = 'fr' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.users.full]);
  try {
    const french = await h.tools.execute(full, 'search_all', { query: 'centre de coûts FR-TRV-600' });
    assert.equal(french.not_read_here[0].where, 'Données de référence › Centres de coûts');
    assert.match(french.not_read_here[0].note, /They are on the screen Données de référence › Centres de coûts\./);
    assert.ok(french.families_not_read.includes('audit log (Administration › Journal d\'audit)'));
    const access = await h.tools.execute(full, 'search_all', { query: 'accès limité aux données' });
    assert.ok(access.not_read_here.some((entry: any) => entry.where === 'Administration › Accès aux données'), 'data access');
    const chargeback = await h.tools.execute(full, 'search_all', { query: 'refacturation 2026 par société bénéficiaire' });
    const unread = chargeback.not_read_here.find((entry: any) => entry.where === 'Gestion budgétaire › Rapports › Refacturation globale');
    assert.ok(unread, 'chargeback');
    assert.match(unread.note, /for a person with the Reporting right, which this person's role does not give/, 'without the Reporting right: the right that is missing');
    const frenchFilters = await h.tools.execute(full, 'describe_entity_filters', { entity_type: 'applications' });
    assert.ok(frenchFilters.families_not_read.some((line: string) => line.startsWith('data access (which companies or cost centers a person is limited to) (Administration › Accès aux données): ')));
  } finally {
    await runner.query(`UPDATE users SET locale = NULL WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.users.full]);
  }
  // A match in a read family still carries no generic list.
  const found = await h.tools.execute(full, 'search_all', { query: 'APP-8' });
  if (found.items.length) assert.equal(found.families_not_read, undefined, 'a match: no generic list');
  const described = await h.tools.execute(full, 'describe_entity_filters', { entity_type: 'applications' });
  assert.ok(described.families_not_read.includes('audit log (en: Admin › Audit log; fr: Administration › Journal d\'audit; de: Administration › Audit-Protokoll; es: Administración › Registro de auditoría)'), 'describe_entity_filters lists them');
  // A reader of the reports reads the chargeback (Plaid L8): not named as unread.
  const reporter = ctx(runner, s, 'reporter');
  const reports = await h.tools.execute(reporter, 'search_all', { query: 'refacturation 2026 par société bénéficiaire' });
  assert.equal((reports.not_read_here ?? []).some((entry: any) => entry.family === 'chargeback by beneficiary company'), false, 'read with the Reporting right');
  const reporterFilters = await h.tools.execute(reporter, 'describe_entity_filters', { entity_type: 'budget_lines' });
  assert.equal(reporterFilters.families_not_read.some((line: string) => line.startsWith('chargeback by beneficiary company')), false);
  assert.ok(described.families_not_read.some((line: string) => line.startsWith('chargeback by beneficiary company') && /Reporting right, which this person's role does not give/.test(line)));
  const tools = await h.tools.listAvailableTools(full);
  const searchTool = tools.find((tool: any) => tool.name === 'search_all');
  assert.match(searchTool.description, /no proof that such a record does not exist/);
  console.log('  P2 q10b, q12, q20: unread families named: OK');
}

async function testApplicationFields(h: Harness, runner: QueryRunner, s: Seed) {
  const full = ctx(runner, s, 'full');
  // P3 q27: RTO and RPO of APP-8 are in its context.
  const context = await h.tools.execute(full, 'get_entity_context', { entity_type: 'applications', entity_id: 'APP-8' });
  const metadata = context.entity.metadata;
  assert.equal(metadata.rto_minutes, 180);
  assert.equal(metadata.rpo_minutes, 15);
  assert.equal(metadata.recovery_wave, 'vital');
  assert.equal(metadata.recovery_wave_label, 'V1 — Vital activities');
  assert.equal(metadata.last_dr_test, '2026-03-14');
  assert.equal(metadata.end_of_support_date, '2030-12-31');
  assert.equal(metadata.business_criticality_label, 'Critical');
  assert.equal(metadata.cyber_criticality, 'critical');
  assert.match(context.fields_note, /extract/);
  // P3-16: the detail gives the labels and ranks, as the list.
  const detail = await h.tools.execute(full, 'get_entity_detail', { entity_type: 'applications', entity_id: 'APP-8' });
  const list = await h.tools.execute(full, 'query_entities', { entity_type: 'applications' });
  for (const field of ['business_criticality_label', 'business_criticality_rank', 'cyber_criticality_label', 'cyber_criticality_rank', 'recovery_wave_label', 'recovery_wave_order']) {
    assert.equal(detail.entity.metadata[field], list.items[0].metadata[field], `${field}: the detail as the list`);
  }
  assert.equal(detail.entity.metadata.business_criticality_rank, 4);
  console.log('  P3 q27, P3-16: application context and detail: OK');
}

async function testFilterValues(h: Harness, runner: QueryRunner, s: Seed) {
  const full = ctx(runner, s, 'full');
  const refused = await h.tools.execute(full, 'query_entities', { entity_type: 'applications', filters: { status: ['active'] } });
  assert.equal(refused.status, 'invalid_filter_value');
  assert.equal(refused.complete, false, 'never a complete empty answer');
  assert.deepEqual(refused.invalid_filter_values, [{ field: 'status', rejected: ['active'], accepted: ['enabled', 'disabled'] }]);
  assert.match(refused.suggested_repairs[0].reason, /Accepted values: "enabled", "disabled"/);
  const mixed = await h.tools.execute(full, 'query_entities', { entity_type: 'projects', filters: { status: ['in_progress', 'ongoing'] } });
  assert.equal(mixed.status, 'invalid_filter_value', 'one unknown value among known ones: refused, never dropped');
  const aggregate = await h.tools.execute(full, 'aggregate_entities', { entity_type: 'applications', group_by: 'lifecycle', filters: { status: ['active'] } });
  assert.equal(aggregate.status, 'invalid_filter_value');
  const unknownField = await h.tools.execute(full, 'query_entities', { entity_type: 'applications', filters: { colour: ['red'] } });
  assert.equal(unknownField.status, 'invalid_filter', 'an unknown field keeps its status');
  const accepted = await h.tools.execute(full, 'query_entities', { entity_type: 'applications', filters: { status: ['enabled'] } });
  assert.equal(accepted.total, 1);
  console.log('  P3-7: invalid_filter_value with the accepted values: OK');
}

async function testDataAccessNote(h: Harness, runner: QueryRunner, s: Seed) {
  const full = ctx(runner, s, 'full');
  const unscoped = await h.executor.execute(full, { entity_type: 'budget_lines' });
  assert.equal(unscoped.data_access, undefined, 'an unscoped person: no note');
  await runner.query(`SELECT set_config('app.da_mode', 'limited', true)`);
  try {
    // B9: the total of a limited account.
    const lines = await h.executor.execute(full, { entity_type: 'budget_lines' });
    assert.equal(lines.data_access, 'limited');
    assert.match(lines.data_access_note, /within your access/);
    assert.match(lines.data_access_note, /never call it the workspace total/);
    const grouped = await h.aggregates.execute(full, { entity_type: 'budget_lines', group_by: 'status', metric: 'y_budget', function: 'sum' });
    assert.equal(grouped.data_access, 'limited');
    const applications = await h.executor.execute(full, { entity_type: 'applications' });
    assert.equal(applications.data_access, undefined, 'applications are not narrowed by data access');
  } finally {
    await runner.query(`SELECT set_config('app.da_mode', '', true)`);
  }
  console.log('  B9: data_access limited on budget figures: OK');
}

async function testRefusalsAndTerms(h: Harness, runner: QueryRunner, s: Seed) {
  // P4-9: the missing right in plain words.
  const refusal = await h.tools.execute(ctx(runner, s, 'appsOnly'), 'query_entities', { entity_type: 'budget_lines' }).then(() => null, (error: any) => error);
  assert.ok(refusal, 'refused');
  assert.equal(refusal.message, 'You need the right to read budget lines, which your role does not give. An administrator can add it to your role.');
  assert.doesNotMatch(refusal.message, /budget:reader/);

  // The number of the current term, counted by the server.
  const full = ctx(runner, s, 'full');
  const detail = await h.tools.execute(full, 'get_entity_detail', { entity_type: 'contracts', entity_id: s.contract });
  assert.equal(detail.entity.metadata.current_term_number, 2, 'second term');
  const context = await h.tools.execute(full, 'get_entity_context', { entity_type: 'contracts', entity_id: s.contract });
  assert.equal(context.entity.metadata.current_term_number, 2);
  console.log('  P4-9 refusal, contract term number: OK');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testTotals(harness, runner, s);
      await testUnreadFamilies(harness, runner, s);
      await testApplicationFields(harness, runner, s);
      await testFilterValues(harness, runner, s);
      await testDataAccessNote(harness, runner, s);
      await testRefusalsAndTerms(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-says-its-limits.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
