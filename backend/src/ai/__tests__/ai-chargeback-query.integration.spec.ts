// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { PgClient, roleExists, seedNodes, seedPerson, seedRole } from '../../data-access/__tests__/data-access-test-helpers';

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-chargeback-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

// The chargeback families of Plaid and the MCP server (Plaid L8, lot D), against the database and
// the real services of the application, every figure compared with `ChargebackReportService` run on
// the same lines:
// - `chargeback` lists the rows of the global report's "Detailed allocations" table (companies, a
//   department, the costs without a department) with paid, net and the indicators, and
//   `chargeback_lines` the lines of the company report; filters on the year, the column (the
//   assistant's `review` is the service's `revision`), the nature and the company;
// - no nature: both natures, said; a nature: that one;
// - the service's warnings in words: a line it could not spread, a line without a paying company,
//   a line in a currency without a rate;
// - the paid amount of each paying company equals budget_lines summed by paying_company on the same
//   year and column (every line active);
// - aggregates by company, department and nature;
// - without the reporting right: refused in words naming the screen;
// - a person limited to one company: the global rows of their lines, no group total; their company
//   report with the lines they do not read named by their BL reference only; another company refused
//   with the service's sentence;
// - another tenant's companies and lines never show.
//
// Fixture (year Y, the current year; reporting currency EUR, 2 USD for 1 EUR; headcounts Alpha 30,
// Bravo 10, so the year's rule spreads 75/25; department D of Alpha):
// - L1 OPEX EUR 1,200 (and 600 in review), paid by Alpha, default spread (not stored);
// - L2 OPEX USD 1,000, paid by Bravo, manual 60 % Alpha › D, 40 % Bravo;
// - L3 CAPEX EUR 600, paid by Bravo, default spread;
// - L4 OPEX EUR 240, no paying company, default spread;
// - L5 OPEX XTS 500, paid by Alpha, no exchange rate;
// - L6 OPEX EUR 300, paid by Alpha, manual by company with no company selected (not spread).

const Y = new Date().getFullYear();

let app: INestApplicationContext;
let dataSource: DataSource;

type Seed = {
  tenantId: string;
  tag: string;
  alpha: string;
  bravo: string;
  alphaName: string;
  bravoName: string;
  department: string;
  lines: Record<'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6', { id: string; number: number; name: string }>;
  admin: string;
  noReporting: string;
  roles: { reporter: string };
};

async function inTransaction(fn: (runner: QueryRunner) => Promise<void>): Promise<void> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

function pg(runner: QueryRunner): PgClient {
  return {
    connect: async () => undefined,
    end: async () => undefined,
    query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }),
  };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function seedTenantRow(runner: QueryRunner, slug: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `${slug}-${tenantId.slice(0, 8)}`, `${slug} ${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  await runner.query(
    `INSERT INTO allocation_rules (tenant_id, fiscal_year, method, mode, company_ids, status) VALUES ($1, $2, 'headcount', 'auto', NULL, 'enabled')`,
    [tenantId, Y],
  );
  return tenantId;
}

async function seedCompany(runner: QueryRunner, tenantId: string, name: string, headcount: number, itUsers: number, turnover: number): Promise<string> {
  const id = await insertId(runner,
    `INSERT INTO companies (tenant_id, name, country_iso, city, status, base_currency) VALUES ($1, $2, 'FR', 'Lyon', 'enabled', 'EUR')`,
    [tenantId, name]);
  await runner.query(
    `INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, it_users, turnover) VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, id, Y, headcount, itUsers, turnover],
  );
  return id;
}

async function seedLine(
  runner: QueryRunner,
  tenantId: string,
  line: { number: number; name: string; nature: 'opex' | 'capex'; currency: string; planned: number; committed?: number; payer: string | null; method?: string },
): Promise<string> {
  const id = await insertId(runner,
    `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, paying_company_id)
     VALUES ($1, $2, $3, $4, $5, '2020-01-01', 'enabled', $6)`,
    [tenantId, line.nature, line.number, line.name, line.currency, line.payer]);
  const versionId = await insertId(runner,
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year, allocation_method)
     VALUES ($1, $2, 'Budget', make_date($3, 1, 1), $3, $4)`,
    [tenantId, id, Y, line.method ?? 'default']);
  await runner.query(
    `INSERT INTO spend_amounts (tenant_id, version_id, period, planned, committed) VALUES ($1, $2, make_date($3, 1, 1), $4, $5)`,
    [tenantId, versionId, Y, line.planned, line.committed ?? 0],
  );
  return versionId;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const [{ current }] = await runner.query(`SELECT current_database() AS current`);
  assert.notEqual(current, 'appdb', 'this spec does not write the dev database');
  await runner.query(`INSERT INTO currencies (code, name) VALUES ('EUR', 'Euro'), ('USD', 'US dollar'), ('XTS', 'Test currency') ON CONFLICT (code) DO NOTHING`);

  // Another tenant first, so the tenant of the spec stays the current one.
  const other = await seedTenantRow(runner, 'ai-chargeback-other');
  const zulu = await seedCompany(runner, other, `Zulu ${other.slice(0, 8)}`, 50, 5, 1);
  await seedLine(runner, other, { number: 1, name: `Zulu line ${other.slice(0, 8)}`, nature: 'opex', currency: 'EUR', planned: 9999, payer: zulu });

  const tenantId = await seedTenantRow(runner, 'ai-chargeback');
  const tag = tenantId.slice(0, 8);
  await runner.query(`INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates) VALUES ($1, $2, 'EUR', $3::jsonb)`, [tenantId, Y, JSON.stringify({ USD: 2 })]);
  const alphaName = `Alpha ${tag}`;
  const bravoName = `Bravo ${tag}`;
  const alpha = await seedCompany(runner, tenantId, alphaName, 30, 10, 5);
  const bravo = await seedCompany(runner, tenantId, bravoName, 10, 5, 2);
  const department = await insertId(runner, `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, $3)`, [tenantId, alpha, `Dept D ${tag}`]);
  await runner.query(`INSERT INTO department_metrics (tenant_id, department_id, fiscal_year, headcount) VALUES ($1, $2, $3, 12)`, [tenantId, department, Y]);

  const name = (label: string) => `CB line ${label} ${tag}`;
  const specs = {
    L1: { number: 1, nature: 'opex', currency: 'EUR', planned: 1200, committed: 600, payer: alpha },
    L2: { number: 2, nature: 'opex', currency: 'USD', planned: 1000, payer: bravo, method: 'manual_pct' },
    L3: { number: 3, nature: 'capex', currency: 'EUR', planned: 600, payer: bravo },
    L4: { number: 4, nature: 'opex', currency: 'EUR', planned: 240, payer: null },
    L5: { number: 5, nature: 'opex', currency: 'XTS', planned: 500, payer: alpha },
    L6: { number: 6, nature: 'opex', currency: 'EUR', planned: 300, payer: alpha, method: 'manual_company' },
  } as const;
  const lines = {} as Seed['lines'];
  for (const [label, spec] of Object.entries(specs) as Array<[keyof typeof specs, (typeof specs)[keyof typeof specs]]>) {
    const versionId = await seedLine(runner, tenantId, { ...spec, name: name(label) });
    const [{ id }] = await runner.query(`SELECT spend_item_id AS id FROM spend_versions WHERE id = $1`, [versionId]);
    lines[label] = { id, number: spec.number, name: name(label) };
    if (label === 'L2') {
      await runner.query(
        `INSERT INTO spend_allocations (tenant_id, version_id, company_id, department_id, allocation_pct) VALUES ($1, $2, $3, $4, 60), ($1, $2, $5, NULL, 40)`,
        [tenantId, versionId, alpha, department, bravo],
      );
    }
  }

  const client = pg(runner);
  const administrator = await seedRole(client, tenantId, 'Administrator');
  const budgetReader = await seedRole(client, tenantId, 'Budget reader');
  await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', 'admin')`, [tenantId, budgetReader]);
  const reporter = await seedRole(client, tenantId, 'Report reader');
  for (const resource of ['budget', 'reporting']) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'reader')`, [tenantId, reporter, resource]);
  }
  return {
    tenantId, tag, alpha, bravo, alphaName, bravoName, department, lines,
    admin: await seedPerson(client, tenantId, 'all', administrator),
    noReporting: await seedPerson(client, tenantId, 'all', budgetReader),
    roles: { reporter },
  };
}

function context(runner: QueryRunner, s: Seed, userId: string) {
  return { tenantId: s.tenantId, userId, isPlatformHost: false, surface: 'mcp', authMethod: 'api_key', manager: runner.manager } as any;
}

function executors() {
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { ChargebackReportService } = require('../../spend/chargeback-report.service');
  return { query: app.get(AiQueryExecutor), aggregates: app.get(AiAggregateExecutor), service: app.get(ChargebackReportService) };
}

async function rejection(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail('expected a refusal');
}

/** The global report's table as `[level, company, department, amount, share]`, in the family's words. */
function serviceTable(report: any): unknown[][] {
  return report.detailedRows.map((row: any) => [
    row.rowType === 'company' ? 'company' : row.departmentId ? 'department' : 'common',
    row.companyName,
    row.rowType === 'company' || !row.departmentId ? null : row.departmentName,
    row.amount,
    row.share,
  ]).sort();
}

function familyTable(result: any): unknown[][] {
  return result.items.map((item: any) => [item.metadata.level, item.metadata.company, item.metadata.department, item.metadata.amount, item.metadata.share]).sort();
}

const round2 = (value: number) => Math.round(value * 100) / 100;

async function testGlobalAsTheReport(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, service } = executors();
    const ctx = context(runner, s, s.admin);
    const opts = { manager: runner.manager };
    const report = await service.generateGlobal(Y, 'budget', s.tenantId, { ...opts, scope: 'all' });

    const listed: any = await query.execute(ctx, { entity_type: 'chargeback', limit: 50 });
    assert.deepEqual(familyTable(listed), serviceTable(report), 'the rows of the detailed allocations table');
    assert.equal(listed.total, report.detailedRows.length);
    assert.ok(listed.items.some((item: any) => item.metadata.level === 'department' && item.metadata.department === `Dept D ${s.tag}`), 'the department of Alpha is a row');
    assert.equal(listed.chargeback.report_total, report.total, 'the report total');
    assert.equal(listed.chargeback.nature, 'both', 'no nature asked: both natures');
    assert.match(listed.chargeback.nature_note, /open on OPEX only/);
    assert.equal(listed.chargeback.column, 'budget', 'the default column of the workspace');
    assert.equal(listed.chargeback.year, Y);
    assert.equal(listed.amounts_currency, 'EUR', 'the amounts are in the reporting currency');
    const companies = new Map(report.companies.map((row: any) => [row.companyName, row]));
    for (const item of listed.items.filter((entry: any) => entry.metadata.level === 'company')) {
      const row: any = companies.get(item.metadata.company);
      assert.deepEqual([item.metadata.paid, item.metadata.net], [row.paid, row.net], `${item.metadata.company}: paid and net`);
      const kpi = report.kpis.find((entry: any) => entry.companyName === item.metadata.company);
      assert.deepEqual(
        [item.metadata.it_users, item.metadata.turnover, item.metadata.cost_per_it_user, item.metadata.cost_vs_turnover_pct],
        [kpi.itUsers, kpi.turnover, kpi.costPerItUser, kpi.costVsTurnoverPct],
        `${item.metadata.company}: the indicators`,
      );
    }
    // 1,200 x 75 % + 500 USD x 60 % + 600 x 75 % + 240 x 75 %: L5 has no rate, L6 is not spread.
    const alpha = listed.items.find((item: any) => item.metadata.level === 'company' && item.metadata.company === s.alphaName);
    assert.equal(alpha.metadata.amount, round2(report.companies.find((row: any) => row.companyName === s.alphaName).amount));
    assert.equal(alpha.metadata.paid, 1500, 'Alpha pays L1 and L6, not the XTS line');

    // The warnings in words, and the note asking to say them.
    const warnings: string[] = listed.chargeback.warnings;
    assert.ok(warnings.some((text) => text === `"${s.lines.L6.name}" (${Y}) is left out of the chargeback, its allocation could not be computed: no company is selected for its manual allocation.`), JSON.stringify(warnings));
    assert.ok(warnings.some((text) => text === `"${s.lines.L4.name}" (${Y}) has no paying company: it counts for the companies it is charged to, in no paid total.`), JSON.stringify(warnings));
    assert.ok(warnings.some((text) => text.startsWith(`No EUR exchange rate for XTS in ${Y} (1 line)`)), JSON.stringify(warnings));
    assert.ok(warnings.every((text) => !/^[a-z_]+$/.test(text)), 'no code');
    assert.match(listed.chargeback.warnings_note, /repeat every warning in the answer/);

    // One nature: the report of that nature.
    const opex = await service.generateGlobal(Y, 'budget', s.tenantId, { ...opts, scope: 'opex' });
    const opexListed: any = await query.execute(ctx, { entity_type: 'chargeback', filters: { nature: ['opex'] }, limit: 50 });
    assert.deepEqual(familyTable(opexListed), serviceTable(opex), 'nature opex: the OPEX report');
    assert.equal(opexListed.chargeback.nature, 'opex');
    assert.deepEqual(opexListed.filters_applied, ['nature']);
    const both: any = await query.execute(ctx, { entity_type: 'chargeback', filters: { nature: ['opex', 'capex'] }, limit: 50 });
    assert.equal(both.chargeback.report_total, report.total, 'both natures named: both');

    // The column in the assistant's words: review is the service's revision.
    const review = await service.generateGlobal(Y, 'revision', s.tenantId, { ...opts, scope: 'all' });
    assert.ok(review.total > 0, 'the review column has an amount');
    const reviewListed: any = await query.execute(ctx, { entity_type: 'chargeback', filters: { column: ['review'] }, limit: 50 });
    assert.equal(reviewListed.chargeback.column, 'review');
    assert.deepEqual(familyTable(reviewListed), serviceTable(review), 'column review: the revision report');

    // The year: one year, other operators refused in words; another year, its own report.
    const empty: any = await query.execute(ctx, { entity_type: 'chargeback', filters: { year: { op: 'eq', value: Y + 5 } } });
    assert.equal(empty.total, 0, 'no line in that year');
    assert.equal(empty.chargeback.year, Y + 5);
    const byArgument: any = await query.execute(ctx, { entity_type: 'chargeback', year: Y + 5 });
    assert.equal(byArgument.chargeback.year, Y + 5, 'the year argument of query_entities');
    const refusedYear = await rejection(() => query.execute(ctx, { entity_type: 'chargeback', filters: { year: { op: 'gte', value: Y } } }));
    assert.match(String(refusedYear?.message), /reads one year/);
    const refusedColumn = await rejection(() => query.execute(ctx, { entity_type: 'chargeback', filters: { column: ['budget', 'review'] } }));
    assert.match(String(refusedColumn?.message), /reads one column/);

    // Filters and sort on the rows.
    const companyRows: any = await query.execute(ctx, { entity_type: 'chargeback', filters: { level: ['company'] }, sort: { field: 'company', direction: 'asc' } });
    assert.deepEqual(companyRows.items.map((item: any) => item.metadata.company), [s.alphaName, s.bravoName]);
    const bravoRows: any = await query.execute(ctx, { entity_type: 'chargeback', filters: { company: 'bravo' } });
    assert.ok(bravoRows.items.length > 0 && bravoRows.items.every((item: any) => item.metadata.company === s.bravoName), 'a part of the company name');

    // No trace of the other tenant.
    assert.doesNotMatch(JSON.stringify([listed, opexListed]), /Zulu/, 'another tenant\'s company never shows');
  });
  console.log('ok - chargeback: the rows, totals, warnings in words, natures, column and year of the global report');
}

async function testCompanyAsTheReport(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, service } = executors();
    const ctx = context(runner, s, s.admin);
    const report = await service.generateCompany(Y, 'budget', s.alpha, s.tenantId, { manager: runner.manager, scope: 'all' });

    const listed: any = await query.execute(ctx, { entity_type: 'chargeback_lines', filters: { company: s.alphaName.toUpperCase() } });
    assert.deepEqual(
      listed.items.map((item: any) => [item.ref, item.label, item.metadata.nature, item.metadata.allocation_method, item.metadata.amount, item.metadata.share_pct]).sort(),
      report.items.map((row: any) => [`BL-${row.itemNumber}`, row.itemName, row.nature, row.allocationMethod, row.amount, row.sharePct]).sort(),
      'the lines of the company report',
    );
    assert.deepEqual(listed.items.map((item: any) => item.ref).sort(), ['BL-1', 'BL-2', 'BL-3', 'BL-4'], 'the lines charged to Alpha');
    assert.ok(listed.items.every((item: any) => item.metadata.readable === true), 'every line read');
    const company = listed.chargeback.company;
    assert.deepEqual(
      [company.name, company.consumed, company.paid, company.net, company.headcount, company.lines_total, company.lines_total_share, company.group_total],
      [report.company.name, report.company.total, report.company.paid, report.company.net, report.company.headcount, report.itemsTotal, report.itemsTotalShare, report.globalKpi.amount],
      'the company and its totals',
    );
    assert.deepEqual(
      company.departments.map((row: any) => [row.level, row.department, row.amount]).sort(),
      report.departments.map((row: any) => [row.departmentId ? 'department' : 'common', row.departmentId ? row.departmentName : null, row.amount]).sort(),
      'its departments',
    );
    assert.equal(listed.chargeback.report, 'company');

    const byPart: any = await query.execute(ctx, { entity_type: 'chargeback_lines', filters: { company: 'alpha', line: 'BL-2' } });
    assert.deepEqual(byPart.items.map((item: any) => item.ref), ['BL-2'], 'a part of the name; a BL reference compares exactly');
    const missing: any = await query.execute(ctx, { entity_type: 'chargeback_lines', filters: { company: 'Nowhere Inc' } });
    assert.deepEqual([missing.total, missing.chargeback.company], [0, null], 'no such company: nothing, said');
    assert.match(missing.chargeback.company_note, /No company is named "Nowhere Inc"/);
    const required = await rejection(() => query.execute(ctx, { entity_type: 'chargeback_lines' }));
    assert.match(String(required?.message), /give the company filter/);

    // Aggregates: by company, by department, by nature; the lines by allocation method.
    const { aggregates } = executors();
    const global = await service.generateGlobal(Y, 'budget', s.tenantId, { manager: runner.manager, scope: 'all' });
    const paid: any = await aggregates.execute(ctx, { entity_type: 'chargeback', group_by: 'company', metric: 'paid', function: 'sum' });
    assert.deepEqual(
      paid.groups.map((group: any) => [group.key, group.value]).sort(),
      global.companies.map((row: any) => [row.companyName, row.paid]).sort(),
      'paid by company, from the company rows only',
    );
    assert.equal(paid.amounts_currency, 'EUR');
    const amounts: any = await aggregates.execute(ctx, { entity_type: 'chargeback', group_by: 'company', metric: 'amount', function: 'sum' });
    assert.deepEqual(
      amounts.groups.map((group: any) => [group.key, group.value]).sort(),
      global.companies.map((row: any) => [row.companyName, row.amount]).sort(),
      'a company\'s amount counted once, not with its departments',
    );
    const departments: any = await aggregates.execute(ctx, { entity_type: 'chargeback', group_by: 'department', metric: 'amount', function: 'sum' });
    assert.equal(round2(departments.groups.reduce((sum: number, group: any) => sum + group.value, 0)), global.total, 'the department and common rows add up to the total');
    const opex = await service.generateGlobal(Y, 'budget', s.tenantId, { manager: runner.manager, scope: 'opex' });
    const capex = await service.generateGlobal(Y, 'budget', s.tenantId, { manager: runner.manager, scope: 'capex' });
    const natures: any = await aggregates.execute(ctx, { entity_type: 'chargeback', group_by: 'nature', metric: 'amount', function: 'sum' });
    assert.deepEqual(natures.groups.map((group: any) => [group.key, group.value]).sort(), [['capex', capex.total], ['opex', opex.total]], 'each nature its report');
    const levels: any = await aggregates.execute(ctx, { entity_type: 'chargeback', group_by: 'level' });
    assert.deepEqual(levels.groups.map((group: any) => [group.key, group.count]).sort(), [['common', 2], ['company', 2], ['department', 1]], 'the rows of each level');
    const methods: any = await aggregates.execute(ctx, { entity_type: 'chargeback_lines', group_by: 'allocation_method', filters: { company: s.alphaName } });
    assert.deepEqual(methods.groups.map((group: any) => [group.key, group.count]).sort(), [['headcount', 3], ['manual_pct', 1]]);
    assert.match(methods.chargeback.company.name, /^Alpha/);
  });
  console.log('ok - chargeback_lines: the lines and figures of the company report; aggregates by company, department, nature and method');
}

/** The paid amount of each paying company equals the budget lines summed by paying company. */
async function testPaidEqualsTheBudgetLines(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, aggregates } = executors();
    const ctx = context(runner, s, s.admin);
    const lines: any = await aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'paying_company', metric: 'y_budget', function: 'sum' });
    const byPayer = new Map(lines.groups.map((group: any) => [group.key, Number(group.value)]));
    const chargeback: any = await query.execute(ctx, { entity_type: 'chargeback', filters: { level: ['company'] } });
    assert.equal(chargeback.items.length, 2);
    for (const item of chargeback.items) {
      assert.equal(item.metadata.paid, round2(byPayer.get(item.metadata.company) as number), `${item.metadata.company}: paid as budget_lines by paying_company`);
    }
    assert.deepEqual(lines.amounts_fx_missing, [{ currency: 'XTS', year: Y, lines: 1 }], 'the same XTS line left out on both sides');
  });
  console.log('ok - chargeback: paid by company equals budget_lines summed by paying company');
}

async function testReportingRight(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, aggregates } = executors();
    const ctx = context(runner, s, s.noReporting);
    for (const run of [
      () => query.execute(ctx, { entity_type: 'chargeback' }),
      () => query.execute(ctx, { entity_type: 'chargeback_lines', filters: { company: s.alphaName } }),
      () => aggregates.execute(ctx, { entity_type: 'chargeback', group_by: 'company' }),
    ]) {
      const refused = await rejection(run);
      assert.equal(refused?.getStatus?.(), 403);
      assert.match(String(refused?.message), /You need the right to read the reports \(the right the Reporting › (Global|Company) chargeback screen asks for\)/, String(refused?.message));
    }
    const { AiPolicyService } = require('../ai-policy.service');
    const policy = app.get(AiPolicyService);
    assert.equal(await policy.canReadEntityType(ctx, 'chargeback', runner.manager), false, 'a budget administrator without reporting does not read it');
    assert.equal(await policy.canReadEntityType(ctx, 'budget_lines', runner.manager), true, 'but reads the lines');
    const reader = await seedPerson(pg(runner), s.tenantId, 'all', s.roles.reporter);
    assert.equal(await policy.canReadEntityType(context(runner, s, reader), 'chargeback_lines', runner.manager), true, 'reporting at reader level reads it');
    assert.ok((await query.execute(context(runner, s, reader), { entity_type: 'chargeback' })).total > 0);
  });
  console.log('ok - chargeback: refused in words without the reporting right');
}

async function testLimitedPerson(): Promise<void> {
  await inTransaction(async (runner) => {
    const client = pg(runner);
    if (!(await roleExists(client))) {
      if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
      console.log('skip - chargeback limited person: kanap_data_limited not installed');
      return;
    }
    const s = await seed(runner);
    const person = await seedPerson(client, s.tenantId, 'limited', s.roles.reporter);
    await seedNodes(client, s.tenantId, person, [{ type: 'company', id: s.alpha, access: 'read' }]);
    assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [person]))[0].mode, 'limited');
    const { query, aggregates, service } = executors();
    const ctx = context(runner, s, person);

    // Global: the lines they read (paid by Alpha), no group total.
    const report = await service.generateGlobal(Y, 'budget', s.tenantId, { manager: runner.manager, scope: 'all' });
    const listed: any = await query.execute(ctx, { entity_type: 'chargeback', limit: 50 });
    assert.deepEqual(familyTable(listed), serviceTable(report), 'the rows of the lines they read');
    assert.equal(listed.chargeback.report_total, null, 'no group total');
    assert.match(listed.chargeback.access_note, /Within your access/);
    assert.equal(listed.data_access, 'limited');
    assert.doesNotMatch(JSON.stringify(listed), new RegExp(`${s.lines.L2.name}|${s.lines.L3.name}|${s.lines.L4.name}`), 'no line they do not read');
    const grouped: any = await aggregates.execute(ctx, { entity_type: 'chargeback', group_by: 'company', metric: 'amount', function: 'sum' });
    assert.equal(grouped.data_access, 'limited');
    assert.equal(grouped.chargeback.report_total, null);

    // Their company: every share charged to it, the lines they do not read by their reference only.
    const company = await service.generateCompany(Y, 'budget', s.alpha, s.tenantId, { manager: runner.manager, scope: 'all' });
    const lines: any = await query.execute(ctx, { entity_type: 'chargeback_lines', filters: { company: s.alphaName } });
    assert.deepEqual(
      lines.items.map((item: any) => [item.ref, item.metadata.readable, item.metadata.amount]).sort(),
      company.items.map((row: any) => [`BL-${row.itemNumber}`, row.readable, row.amount]).sort(),
      'the lines of the company report',
    );
    const hidden = lines.items.filter((item: any) => item.metadata.readable === false);
    assert.deepEqual(hidden.map((item: any) => item.ref).sort(), ['BL-2', 'BL-3', 'BL-4'], 'the lines Alpha does not pay');
    for (const item of hidden) {
      assert.equal(item.id, item.ref, `${item.ref}: no id`);
      assert.equal(item.label, item.ref, `${item.ref}: named by its reference only`);
    }
    for (const label of ['L2', 'L3', 'L4'] as const) {
      const text = JSON.stringify(lines);
      assert.ok(!text.includes(s.lines[label].name) && !text.includes(s.lines[label].id), `${label}: neither name nor id`);
    }
    assert.equal(lines.chargeback.company.group_total, null, 'no group total');
    assert.match(lines.chargeback.access_note, /named by their reference only/);

    // Another company: the service's sentence.
    const { DATA_ACCESS_CHARGEBACK_COMPANY_MESSAGE } = require('../../spend/chargeback-report.service');
    for (const run of [
      () => query.execute(ctx, { entity_type: 'chargeback_lines', filters: { company: s.bravoName } }),
      () => aggregates.execute(ctx, { entity_type: 'chargeback_lines', group_by: 'nature', filters: { company: s.bravoName } }),
    ]) {
      const refused = await rejection(run);
      assert.equal(refused?.message, DATA_ACCESS_CHARGEBACK_COMPANY_MESSAGE);
      assert.equal(refused?.getStatus?.(), 403);
    }
  });
  console.log('ok - chargeback: a limited person reads their lines, their company by reference, another company refused');
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-chargeback-query.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  dataSource = app.get(DataSource);
  const failures: string[] = [];
  try {
    for (const [name, test] of [
      ['global as the report', testGlobalAsTheReport],
      ['company as the report', testCompanyAsTheReport],
      ['paid equals the budget lines', testPaidEqualsTheBudgetLines],
      ['reporting right', testReportingRight],
      ['limited person', testLimitedPerson],
    ] as Array<[string, () => Promise<void>]>) {
      try {
        await test();
      } catch (error: any) {
        failures.push(`${name}: ${error?.stack ?? error}`);
      }
    }
  } finally {
    await app.close();
  }
  if (failures.length) {
    console.error(failures.join('\n\n'));
    process.exit(1);
  }
  console.log('ai-chargeback-query.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
