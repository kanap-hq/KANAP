// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import AdmZip = require('adm-zip');
import { lastValueFrom, from } from 'rxjs';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { ExportEventsInterceptor } from '../../audit/export-events.interceptor';
import { applyDataAccess, DATA_ACCESS_HEADER } from '../../data-access/data-access';
import { DataAccessLimitedException } from '../../data-access/line-write-checks';
import { LIMITED_ROLE, PgClient, roleExists } from '../../data-access/__tests__/data-access-test-helpers';
import { Seed, seed } from '../../data-access/__tests__/data-access-line-seed';
import { AllocationCalculatorService } from '../allocation-calculator.service';
import { ChargebackReportController } from '../chargeback-report.controller';
import { CHARGEBACK_EXPORT_LABELS } from '../chargeback-report.export';
import { ChargebackReportService, CompanyChargebackReportResponse } from '../chargeback-report.service';

/**
 * The chargeback exports against the data routes, on the data-scoped access reference example
 * (`data-access-line-seed.ts`, the shares of `data-access-chargeback.spec.ts`), in one rolled-back
 * transaction, each person in a savepoint after `applyDataAccess`. For the same parameters, each table
 * of each file holds the rows the data route returns (detailed, companies, flows, KPIs; departments,
 * lines, intercompany, KPIs), amounts to the cent, shares as fractions, totals as footer rows only: the
 * amount columns of the data rows add up to the screen's totals (per-user costs and the netted flows
 * have none). A limited
 * person gets their coverage only, no footer, the access line, and a 403 outside it. Refused requests,
 * then the audit row with the format and the row count.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });
const YEAR = 2026;
const L = CHARGEBACK_EXPORT_LABELS.en;

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

function controller(): ChargebackReportController {
  const fxRates = {
    resolveRates: async () => ({ settings: { reportingCurrency: 'EUR' }, map: new Map() }),
    convertValue: (value: number, rate: number) => value * rate,
  };
  const calculator = new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any);
  return new ChargebackReportController(new ChargebackReportService(undefined as any, calculator, fxRates as any));
}

async function as<T>(runner: QueryRunner, person: string, fn: (m: EntityManager) => Promise<T>): Promise<T> {
  await runner.query('SAVEPOINT person');
  try {
    await applyDataAccess(runner, person);
    return await fn(runner.manager);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT person');
  }
}

/** The shares of `data-access-chargeback.spec.ts`: L1 60 % FR, 40 % ES (an ES department); L4 50/50. */
async function seedShares(runner: QueryRunner, s: Seed): Promise<void> {
  const departmentEs = (await runner.query(
    `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Finance ES') RETURNING id`, [s.tenantId, s.es],
  ))[0].id as string;
  await runner.query(`UPDATE spend_versions SET allocation_method = 'manual_pct' WHERE tenant_id = $1`, [s.tenantId]);
  await runner.query(`DELETE FROM spend_allocations WHERE version_id = ANY($1::uuid[])`, [[s.versions.L1, s.versions.L4]]);
  const share = (version: string, company: string, pct: number, department: string | null = null) => runner.query(
    `INSERT INTO spend_allocations (tenant_id, version_id, company_id, department_id, allocation_pct) VALUES ($1, $2, $3, $4, $5)`,
    [s.tenantId, version, company, department, pct],
  );
  await share(s.versions.L1, s.fr, 60);
  await share(s.versions.L1, s.es, 40, departmentEs);
  await share(s.versions.L4, s.fr, 50);
  await share(s.versions.L4, s.es, 50);
}

function request(m: EntityManager, s: Seed, person: string, query: Record<string, unknown>, path: string) {
  return { queryRunner: { manager: m, isReleased: false }, tenant: { id: s.tenantId }, user: { sub: person }, query, path };
}

function response(req: unknown) {
  const headers: Record<string, string> = {};
  let body: Buffer | null = null;
  const res: any = {
    req,
    headersSent: false,
    setHeader: (name: string, value: string) => { headers[name] = value; },
    getHeader: (name: string) => headers[name],
    send: (value: Buffer) => { body = value; res.headersSent = true; },
  };
  return { res, headers, body: () => body! };
}

const unescape = (text: string) => text.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const columnIndex = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** The sheets of a workbook by name, each as rows of cell texts ('' for an empty cell). */
function workbook(buffer: Buffer): Map<string, string[][]> {
  const zip = new AdmZip(buffer);
  const names = [...zip.readAsText('xl/workbook.xml').matchAll(/<sheet name="([^"]*)"/g)].map((m) => unescape(m[1]));
  const sheets = new Map<string, string[][]>();
  names.forEach((name, index) => {
    const xml = zip.readAsText(`xl/worksheets/sheet${index + 1}.xml`);
    const rows = [...xml.matchAll(/<row r="\d+">(.*?)<\/row>/gs)].map((row) => {
      const cells: string[] = [];
      for (const m of row[1].matchAll(/<c r="([A-Z]+)\d+"[^>]*>(?:<is><t xml:space="preserve">([^<]*)<\/t><\/is>|<v>([^<]*)<\/v>)<\/c>/g)) {
        cells[columnIndex(m[1])] = unescape(m[2] ?? m[3]);
      }
      return Array.from(cells, (cell) => cell ?? '');
    });
    sheets.set(name, rows);
  });
  return sheets;
}

/** A row as the file writes it: trailing empty cells are not written. */
const trim = (row: string[]): string[] => {
  const out = [...row];
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
};
const amount = (value: number | null | undefined) => (value == null ? '' : (Math.round(value * 100) / 100).toFixed(2));
const fraction = (value: number | null | undefined) => (value == null ? '' : String(value));
const points = (value: number | null | undefined) => (value == null ? '' : String(Number((value / 100).toPrecision(12))));
const count = (value: number | null | undefined) => (value == null ? '' : String(value));
const department = (id: string | null, name: string | null) => (id == null ? L.commonCosts : name?.trim() || L.unknownDepartment);

/** The sum of a column over the data rows, in cents (the cells are written to the cent). */
const cents = (rows: string[][], index: number) => rows.reduce((sum, row) => sum + Math.round(Number(row[index] || 0) * 100), 0);
const toCents = (value: number | null | undefined) => Math.round((value ?? 0) * 100);

function body(sheets: Map<string, string[][]>, name: string): string[][] {
  const rows = sheets.get(name);
  assert.ok(rows, `sheet ${name}`);
  return rows.slice(1).map(trim);
}

async function exportFile(c: ChargebackReportController, m: EntityManager, s: Seed, person: string, route: 'global' | 'company', query: Record<string, unknown>) {
  const req = request(m, s, person, query, `/reports/chargeback/${route}/export`);
  const out = response(req);
  if (route === 'global') await c.exportGlobal(query, req, out.res);
  else await c.exportCompany(query, req, out.res);
  return { ...out, req };
}

async function testGlobal(runner: QueryRunner, s: Seed): Promise<void> {
  const c = controller();
  const { persons: p } = s;
  for (const [who, person, limited] of [['admin', p.admin, false], ['marta', p.marta, true]] as const) {
    await as(runner, person, async (m) => {
      const data = await c.global(String(YEAR), 'budget', 'opex', request(m, s, person, {}, '/reports/chargeback/global'));
      const file = await exportFile(c, m, s, person, 'global', { year: String(YEAR), metric: 'budget', scope: 'opex', format: 'xlsx', language: 'en' });
      const sheets = workbook(file.body());
      assert.deepEqual([...sheets.keys()], [L.detailedSheet, L.companiesSheet, L.flowsSheet, L.kpisSheet, 'Parameters'], `${who}: the four tables`);
      const detailed = body(sheets, L.detailedSheet);
      assert.deepEqual(detailed, data.detailedRows.filter((row) => row.rowType === 'department').map((row) => trim([
        row.companyName,
        department(row.departmentId, row.departmentName),
        amount(row.amount), fraction(row.share), count(row.headcount), amount(row.costPerUser),
      ])), `${who}: detailed = the data route's department rows, no company total row`);
      assert.ok(data.detailedRows.some((row) => row.rowType === 'company') && data.detailedRows.some((row) => row.rowType === 'department'));
      // Every amount column adds up to the screen's total: the company total rows, the KPI total.
      const screenTotal = data.detailedRows.filter((row) => row.rowType === 'company').reduce((sum, row) => sum + toCents(row.amount), 0);
      assert.equal(cents(detailed, 2), screenTotal, `${who}: detailed amounts add up to the company totals`);
      assert.equal(screenTotal, toCents(data.kpiTotals!.amount), `${who}: the company totals are the KPI total`);
      const companies = body(sheets, L.companiesSheet);
      assert.deepEqual(companies, data.companies.map((row) => trim([
        row.companyName, amount(row.amount), amount(row.paid), amount(row.net), fraction(row.share),
      ])), `${who}: companies`);
      assert.equal(cents(companies, 1), screenTotal, `${who}: company amounts add up to the total`);
      assert.deepEqual(body(sheets, L.flowsSheet), data.nettedFlows.map((row) => trim([
        row.payerName ?? L.unknownCompany, row.consumerName ?? L.unknownCompany, amount(row.amount),
      ])), `${who}: netted flows`);
      assert.ok(data.nettedFlows.length > 0, 'the seed has intercompany flows');
      const kpiRows = data.kpis.map((row) => trim([
        row.companyName, amount(row.amount), count(row.headcount), count(row.itUsers), amount(row.turnover),
        points(row.costVsTurnoverPct), amount(row.costPerUser), amount(row.costPerItUser),
      ]));
      const totals = data.kpiTotals!;
      const footer = trim([L.kpiTotal, amount(totals.amount), count(totals.headcount), count(totals.itUsers), totals.turnover > 0 ? amount(totals.turnover) : '',
        points(totals.costVsTurnoverPct), amount(totals.costPerUser), amount(totals.costPerItUser)]);
      assert.deepEqual(body(sheets, L.kpisSheet), limited ? kpiRows : [...kpiRows, footer], `${who}: KPIs${limited ? ', no footer' : ' then their totals'}`);
      assert.equal(cents(kpiRows, 1), toCents(totals.amount), `${who}: KPI amounts add up to their total`);
      assert.equal(cents(kpiRows, 4), toCents(totals.turnover), `${who}: KPI turnovers add up to their total`);
      const parameters = sheets.get('Parameters')!.map(trim);
      assert.deepEqual(parameters.slice(1, 5), [['Line type', 'OPEX'], ['Year', String(YEAR)], ['Column', 'Budget'], ['Reporting currency', 'EUR']]);
      assert.equal(parameters.some((row) => row[0] === 'Computed on your access'), limited, `${who}: the access line`);
      assert.equal(file.headers[DATA_ACCESS_HEADER] === 'limited', limited);
      assert.match(file.headers['Content-Disposition'], /filename="chargeback-global-opex-2026-\d{4}-\d{2}-\d{2}\.xlsx"/);
    });
  }
  console.log('  global export: detailed, companies, flows, KPIs equal the data route; limited without footer: OK');
}

function companyRows(data: CompanyChargebackReportResponse, limited: boolean) {
  return {
    departments: data.departments.map((row) => trim([
      department(row.departmentId, row.departmentName), amount(row.amount), points(row.sharePct), count(row.headcount), amount(row.costPerUser),
    ])),
    items: data.items.map((row) => trim([
      row.itemLabel,
      ...(limited ? [row.payingCompanyName ?? ''] : []),
      L[`method_${row.allocationMethod}` as keyof typeof L],
      ...(limited ? [points(row.allocationPct), (row.departments ?? []).map((name) => name ?? L.unknownDepartment).join(', ')] : []),
      amount(row.amount), points(row.sharePct),
    ])),
    intercompany: data.intercompanyRows.map((row) => trim([
      row.partnerName ?? L.unknownCompany, amount(row.receivables), amount(row.payables), amount(row.net),
    ])),
    kpis: data.kpis.map((row) => trim([
      row.companyName, amount(row.amount), count(row.headcount), count(row.itUsers), amount(row.turnover),
      points(row.costVsTurnoverPct), amount(row.costPerUser), amount(row.costPerItUser),
    ])),
  };
}

async function testCompany(runner: QueryRunner, s: Seed): Promise<void> {
  const c = controller();
  const { persons: p } = s;
  for (const [who, person, limited] of [['admin', p.admin, false], ['marta', p.marta, true]] as const) {
    await as(runner, person, async (m) => {
      const data = await c.company(s.es, String(YEAR), 'budget', 'opex', request(m, s, person, {}, '/reports/chargeback/company'));
      const query = { companyId: s.es, year: String(YEAR), metric: 'budget', scope: 'opex', format: 'xlsx', language: 'en' };
      const file = await exportFile(c, m, s, person, 'company', query);
      const sheets = workbook(file.body());
      const expected = companyRows(data, limited);
      assert.equal(data.dataAccessLimited === true, limited);
      assert.ok(expected.items.length > 0 && expected.intercompany.length > 0 && expected.departments.length > 0, 'the seed fills every table');
      assert.deepEqual(body(sheets, L.departmentsSheet), expected.departments, `${who}: departments`);
      assert.equal(cents(expected.departments, 1), toCents(data.company.total), `${who}: department amounts add up to the company's total`);
      assert.equal(cents(expected.items, limited ? 5 : 2), toCents(data.itemsTotal), `${who}: line amounts add up to their total`);
      const itemsFooter = trim([L.rowTotal, ...(limited ? [''] : []), '', ...(limited ? ['', ''] : []), amount(data.itemsTotal), fraction(data.itemsTotalShare)]);
      assert.deepEqual(body(sheets, L.itemsSheet), limited ? expected.items : [...expected.items, itemsFooter], `${who}: lines`);
      assert.equal(sheets.get(L.itemsSheet)![0].length, limited ? 7 : 4, `${who}: the line columns of the screen`);
      if (limited) assert.ok(data.items.some((row) => row.readable === false && row.itemLabel.startsWith('BL-')), 'Marta: a line she cannot read, by reference');
      const total = data.intercompanyTotal!;
      const icFooter = [L.rowTotal, amount(total.receivables), amount(total.payables), amount(total.net)];
      assert.deepEqual([1, 2, 3].map((index) => cents(expected.intercompany, index)), [total.receivables, total.payables, total.net].map(toCents), `${who}: intercompany columns add up to their total`);
      assert.deepEqual(body(sheets, L.intercompanySheet), limited ? expected.intercompany : [...expected.intercompany, icFooter], `${who}: intercompany`);
      const global = data.globalKpi;
      const kpiFooter = global ? [trim([L.globalTotals, amount(global.amount), count(global.headcount), count(global.itUsers), amount(global.turnover),
        points(global.costVsTurnoverPct), amount(global.costPerUser), amount(global.costPerItUser)])] : [];
      assert.deepEqual(body(sheets, L.kpisSheet), [...expected.kpis, ...kpiFooter], `${who}: KPIs`);
      assert.equal(kpiFooter.length, limited ? 0 : 1);
      // The KPI footer is the group's totals, beside the company's own row: a comparison, not a sum.
      const parameters = sheets.get('Parameters')!.map(trim);
      assert.deepEqual(parameters.slice(1, 6), [['Line type', 'OPEX'], ['Year', String(YEAR)], ['Column', 'Budget'], ['Company', data.company.name], ['Reporting currency', 'EUR']]);
      assert.equal(parameters.some((row) => row[0] === 'Computed on your access'), limited);
      assert.match(file.headers['Content-Disposition'], /filename="chargeback-company-opex-2026-\d{4}-\d{2}-\d{2}\.xlsx"/, 'no company id in the name');

      // CSV: one table, the one asked.
      const csv = await exportFile(c, m, s, person, 'company', { ...query, format: 'csv', table: 'intercompany' });
      const lines = csv.body().toString('utf8').replace(/^﻿/, '').trimEnd().split(/\r?\n/);
      assert.equal(lines.length, 1 + expected.intercompany.length + (limited ? 0 : 1), `${who}: CSV of the intercompany table`);
      assert.match(csv.headers['Content-Disposition'], /chargeback-company-opex-2026-intercompany-\d{4}-\d{2}-\d{2}\.csv/);
    });
  }

  // Outside the coverage: the export refuses as the data route does.
  for (const [who, person, companyId] of [['marta', p.marta, s.fr], ['nina', p.nina, s.es]] as const) {
    await as(runner, person, async (m) => {
      await assert.rejects(
        () => exportFile(c, m, s, person, 'company', { companyId, year: String(YEAR), format: 'xlsx' }),
        (error: any) => error instanceof DataAccessLimitedException && error.getStatus() === 403,
        `${who}: 403 on the export`,
      );
    });
    await as(runner, person, async (m) => {
      await assert.rejects(
        () => c.company(companyId, String(YEAR), 'budget', 'opex', request(m, s, person, {}, '/reports/chargeback/company')),
        (error: any) => error instanceof DataAccessLimitedException,
        `${who}: 403 on the data route too`,
      );
    });
  }
  console.log('  company export: departments, lines, intercompany, KPIs equal the data route; limited columns, no footer, 403 outside: OK');
}

async function testRefused(runner: QueryRunner, s: Seed): Promise<void> {
  const c = controller();
  await as(runner, s.persons.admin, async (m) => {
    const cases: Array<['global' | 'company', Record<string, unknown>, RegExp]> = [
      ['global', { year: String(YEAR), sort: 'name' }, /Unknown parameter: sort/],
      ['global', { year: String(YEAR), format: 'csv' }, /table is required/],
      ['global', { year: String(YEAR), format: 'csv', table: 'items' }, /table must be one of detailed, companies, flows, kpis/],
      ['global', { year: '26' }, /year must be a year/],
      ['global', { scope: 'opex,capex' }, /Unknown scope/],
      ['global', { metric: 'actuals' }, /Unknown column/],
      ['global', { format: 'pdf' }, /format must be csv or xlsx/],
      ['global', { language: 'it' }, /language must be en, fr, de or es/],
      ['company', { year: String(YEAR) }, /companyId must be a company id/],
      ['company', { companyId: 'acme' }, /companyId must be a company id/],
      ['company', { companyId: s.es, company_id: s.es }, /Unknown parameter: company_id/],
      ['company', { companyId: s.es, format: 'csv', table: 'detailed' }, /table must be one of departments, items, intercompany, kpis/],
    ];
    for (const [route, query, message] of cases) {
      await assert.rejects(
        () => exportFile(c, m, s, s.persons.admin, route, query),
        (error: any) => error.getStatus?.() === 400 && message.test(error.message),
        `${route} ${JSON.stringify(query)}`,
      );
    }
  });
  console.log('  refused: unknown parameter or table, CSV without table, invalid year, scope, column, format, language, company: OK');
}

/** The audit row the export interceptor writes, completed with the format and the data row count. */
async function testAudit(runner: QueryRunner, s: Seed): Promise<void> {
  const c = controller();
  const person = s.persons.admin;
  await as(runner, person, async (m) => {
    const query = { companyId: s.es, year: String(YEAR), metric: 'budget', format: 'xlsx', language: 'en' };
    const req = request(m, s, person, query, '/reports/chargeback/company/export');
    const out = response(req);
    const context: any = {
      getType: () => 'http',
      getClass: () => ChargebackReportController,
      getHandler: () => ChargebackReportController.prototype.exportCompany,
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => out.res }),
    };
    await lastValueFrom(new ExportEventsInterceptor().intercept(context, { handle: () => from(c.exportCompany(query, req, out.res)) }), { defaultValue: undefined });
    const data = await c.company(s.es, String(YEAR), 'budget', 'opex', request(m, s, person, {}, '/reports/chargeback/company'));
    const rows: Array<{ after: any }> = await m.query(
      `SELECT after_json AS after FROM audit_log WHERE tenant_id = $1 AND table_name = 'export' AND after_json->>'path' = $2`,
      [s.tenantId, '/reports/chargeback/company/export'],
    );
    assert.equal(rows.length, 1, 'one export row');
    const expectedRows = data.departments.length + data.items.length + data.intercompanyRows.length + data.kpis.length;
    assert.deepEqual(
      { resource: rows[0].after.resource, format: rows[0].after.format, rows: rows[0].after.rows },
      { resource: 'reports/chargeback/company', format: 'xlsx', rows: expectedRows },
      'resource, format and the data rows of every table, footers left out',
    );
  });
  console.log('  audit: the export row carries the format and the row count: OK');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`chargeback export: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('chargeback exports against the data routes');
    await runner.startTransaction();
    try {
      const s = await seed(clientOf(runner));
      await seedShares(runner, s);
      await testGlobal(runner, s);
      await testCompany(runner, s);
      await testRefused(runner, s);
      await testAudit(runner, s);
    } finally {
      await runner.rollbackTransaction();
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
  console.log('chargeback-export.integration.spec: OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
