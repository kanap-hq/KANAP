import * as assert from 'node:assert/strict';
import 'reflect-metadata';
import { defer, lastValueFrom } from 'rxjs';
import AdmZip = require('adm-zip');
import { ExportEventsInterceptor } from '../../../audit/export-events.interceptor';
import { XLSX_CONTENT_TYPE } from '../../xlsx';
import { amountCell, dayCell, endOfValidityDay, listCsvText, ListExportCell, numberCell, writeListExport } from '../list-export';
import { AccountsController } from '../../../accounts/accounts.controller';
import { ChartOfAccountsController } from '../../../accounts/chart-of-accounts.controller';
import { AnalyticsCategoriesController } from '../../../analytics/analytics-categories.controller';
import { BusinessProcessesController } from '../../../business-processes/business-processes.controller';
import { CompaniesController } from '../../../companies/companies.controller';
import { ContactsController } from '../../../contacts/contacts.controller';
import { ContractsController } from '../../../contracts/contracts.controller';
import { CostCentersController } from '../../../cost-centers/cost-centers.controller';
import { DataAccessController } from '../../../data-access/data-access.controller';
import { DepartmentsController } from '../../../departments/departments.controller';
import { SuppliersController } from '../../../suppliers/suppliers.controller';
import { TechnologiesController } from '../../../technologies/technologies.controller';
import { UsersController } from '../../../users/users.controller';
import { WorkingDayProfilesController } from '../../../working-day-profiles/working-day-profiles.controller';

// The list exports written with typed cells (`writeListExport`: the master-data files, data access,
// the technology link files), without a database. The cells: the CSV text of each kind is what the
// exports wrote before (the goldens of list-export-golden.integration.spec.ts pin the files), the
// workbook holds numbers, exact amounts and days. The routes, run through the export interceptor as
// Nest runs them: `format` (csv by default, xlsx; anything else, or xlsx for a template, 400 before
// any work) reaches the service, the file goes out with its type and name, and the export row of the
// audit log gets the format and the row count before the body is sent.

const HEADERS = ['name', 'amount', 'day', 'count'];
const ROWS: ListExportCell[][] = [
  ['Alpha', amountCell('-1250.500'), dayCell('2026-03-01'), numberCell(36)],
  ['=cmd', amountCell(null), endOfValidityDay('2025-12-31T23:30:00Z'), numberCell('19.083333')],
  ['000123', amountCell('12'), null, numberCell('20.50')],
];
const SHEETS = { en: 'Probes', fr: 'Sondes', de: 'Sonden', es: 'Sondas' };

function testCells() {
  assert.deepEqual(ROWS.map((row) => row.map((cell) => listCsvText(cell, 'fr'))), [
    ['Alpha', '-1250,500', '01/03/2026', '36'],
    ['=cmd', '', '31/12/2025', '19.083333'],
    ['000123', '12', '', '20.50'],
  ], 'CSV text in French: decimal comma on amounts, days day first, numbers and codes as stored');
  assert.deepEqual(ROWS.map((row) => row.map((cell) => listCsvText(cell, 'en'))).map((row) => row[2]), ['2026-03-01', '2025-12-31', '']);
  assert.equal(numberCell('20.50'), '20.50', 'a stored text that is not its number stays text');
  assert.equal(numberCell(''), null);
  assert.deepEqual(endOfValidityDay(new Date('2025-06-30T12:00:00Z')), { kind: 'date', iso: '2025-06-30' });
  assert.equal(endOfValidityDay('not a day'), null);

  const csv = writeListExport({ format: 'csv', language: 'fr', filename: 'probe.csv', sheetNames: SHEETS, headers: HEADERS, rows: ROWS });
  assert.equal(csv.filename, 'probe.csv');
  assert.equal(csv.contentType, 'text/csv; charset=utf-8');
  assert.equal(csv.rows, 3);
  assert.equal(csv.content, "﻿name;amount;day;count\nAlpha;-1250,500;01/03/2026;36\n'=cmd;;31/12/2025;19.083333\n000123;12;;20.50\n");

  const xlsx = writeListExport({ format: 'xlsx', language: 'fr', filename: 'probe.csv', sheetNames: SHEETS, headers: HEADERS, rows: ROWS });
  assert.equal(xlsx.filename, 'probe.xlsx');
  assert.equal(xlsx.contentType, XLSX_CONTENT_TYPE);
  assert.equal(xlsx.rows, 3);
  const zip = new AdmZip(xlsx.content);
  assert.match(zip.readAsText('xl/workbook.xml'), /<sheet name="Sondes"/, 'the sheet in the language');
  const sheet = zip.readAsText('xl/worksheets/sheet1.xml');
  assert.match(sheet, /<c r="B2" s="\d+"><v>-1250.500<\/v><\/c>/, 'an exact amount');
  assert.match(sheet, /<c r="C2" s="\d+"><v>46082<\/v><\/c>/, 'a day as a date serial');
  assert.match(sheet, /<c r="D2"><v>36<\/v><\/c>/, 'a count');
  assert.match(sheet, /<c r="D3"><v>19.083333<\/v><\/c>/, 'days as a number');
  assert.match(sheet, /<t xml:space="preserve">&apos;=cmd<\/t>/, 'the formula guard');
  assert.match(sheet, /<c r="A4" t="inlineStr"[^>]*><is><t[^>]*>000123<\/t>/, 'a code keeps its leading zeros');
  assert.match(sheet, /<c r="D4" t="inlineStr"[^>]*><is><t[^>]*>20.50<\/t>/, 'a stored text stays text');
  console.log('  typed cells: CSV text as before, workbook numbers, amounts, days, codes, guard: OK');
}

type Probe = {
  name: string;
  path: string;
  type: any;
  handler: string;
  /** The service property of the controller and the methods the handler calls on it. */
  service: string;
  methods: string[];
  template?: boolean;
  call: (c: any, format: string | undefined, scope: 'data' | 'template', req: any, res: any) => Promise<unknown>;
};

const q = (format: string | undefined, scope: string) => ({ scope, language: 'fr', ...(format === undefined ? {} : { format }) });

const probes: Probe[] = [
  { name: 'accounts', path: '/accounts/export', type: AccountsController, handler: 'export', service: 'svc', methods: ['exportCsv'],
    call: (c, f, s, req, res) => c.export(s, undefined, 'fr', q(f, s), res, req.ctx) },
  { name: 'chart accounts', path: '/chart-of-accounts/c1/accounts/export', type: ChartOfAccountsController, handler: 'exportAccounts', service: 'svc', methods: ['exportAccountsCsv'],
    call: (c, f, s, req, res) => c.exportAccounts('c1', s, 'fr', req, q(f, s), res) },
  { name: 'analytics values', path: '/analytics-categories/export', type: AnalyticsCategoriesController, handler: 'export', service: 'csv', methods: ['exportCsv'],
    call: (c, f, s, req, res) => c.export(s, 'fr', q(f, s), res, req.ctx) },
  { name: 'business processes', path: '/business-processes/export', type: BusinessProcessesController, handler: 'export', service: 'svc', methods: ['exportCsv'],
    call: (c, f, s, req, res) => c.export(s, 'fr', q(f, s), res, req) },
  { name: 'companies', path: '/companies/export', type: CompaniesController, handler: 'export', service: 'svc', methods: ['exportCsv'],
    call: (c, f, s, req, res) => c.export(s, '2026', 'fr', q(f, s), res, req.ctx) },
  { name: 'contacts', path: '/contacts/export', type: ContactsController, handler: 'export', service: 'svc', methods: ['exportCsv'],
    call: (c, f, s, req, res) => c.export(s, 'fr', q(f, s), res, req) },
  { name: 'contracts', path: '/contracts/export', type: ContractsController, handler: 'export', service: 'svc', methods: ['exportCsv'],
    call: (c, f, s, req, res) => c.export(s, q(f, s), res, req) },
  { name: 'cost centers', path: '/cost-centers/export', type: CostCentersController, handler: 'export', service: 'csv', methods: ['exportCsv'],
    call: (c, f, s, req, res) => c.export(s, 'fr', q(f, s), res, req.ctx) },
  { name: 'data access', path: '/data-access/export', type: DataAccessController, handler: 'export', service: 'svc', methods: ['exportCsv'], template: false,
    call: (c, f, _s, req, res) => c.export('fr', f, res, req.ctx) },
  { name: 'departments', path: '/departments/export', type: DepartmentsController, handler: 'export', service: 'svc', methods: ['exportCsv'],
    call: (c, f, s, req, res) => c.export(s, 'fr', q(f, s), res, req.ctx) },
  { name: 'suppliers', path: '/suppliers/export', type: SuppliersController, handler: 'export', service: 'svc', methods: ['exportCsv'],
    call: (c, f, s, req, res) => c.export(s, 'fr', q(f, s), res, req) },
  { name: 'users', path: '/users/export', type: UsersController, handler: 'export', service: 'svc', methods: ['exportCsv'],
    call: (c, f, s, req, res) => c.export(s, 'fr', q(f, s), res, req) },
  { name: 'working-day calendars', path: '/working-day-profiles/export', type: WorkingDayProfilesController, handler: 'export', service: 'csv', methods: ['exportCsv'],
    call: (c, f, s, req, res) => c.export(s, 'fr', q(f, s), res, req.ctx) },
  { name: 'asset links', path: '/technologies/asset-links/export', type: TechnologiesController, handler: 'exportAssetLinks', service: 'linkFiles', methods: ['exportAssetLinks'],
    call: (c, f, s, req, res) => c.exportAssetLinks(s, 'fr', res, req.ctx, f) },
  { name: 'application links', path: '/technologies/application-links/export', type: TechnologiesController, handler: 'exportApplicationLinks', service: 'linkFiles', methods: ['exportApplicationLinks'],
    call: (c, f, s, req, res) => c.exportApplicationLinks(s, 'fr', res, req.ctx, f) },
];

const manager = (queries: Array<{ sql: string; params?: unknown[] }>) => ({
  getRepository: () => ({ insert: async () => ({ identifiers: [{ id: 'row-1' }] }) }),
  query: async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    return [];
  },
});

/** The format and scope the service was handed: a positional argument, or a key of an options object. */
function formatOf(args: unknown[]): string {
  for (const arg of args) {
    if (arg === 'csv' || arg === 'xlsx') return arg;
    if (arg && typeof arg === 'object' && 'format' in arg) return String((arg as { format?: unknown }).format ?? 'csv');
  }
  return 'csv';
}

function controllerWith(probe: Probe, seen: unknown[][]) {
  const controller = Object.create(probe.type.prototype);
  const service: Record<string, unknown> = {};
  for (const method of probe.methods) {
    service[method] = async (...args: unknown[]) => {
      seen.push(args);
      const scope = args.find((arg) => arg === 'template' || arg === 'data') ?? (args[1] as any)?.scope ?? 'data';
      return writeListExport({
        format: formatOf(args) as 'csv' | 'xlsx',
        language: 'fr',
        filename: 'probe.csv',
        sheetNames: SHEETS,
        headers: HEADERS,
        rows: scope === 'template' ? [] : ROWS,
      });
    };
  }
  controller[probe.service] = service;
  controller.requireApplications = async () => ({ scope: null });
  return controller;
}

async function run(probe: Probe, format: string | undefined, scope: 'data' | 'template' = 'data') {
  const headers: Record<string, string> = {};
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const seen: unknown[][] = [];
  const mg = manager(queries);
  const req: any = {
    tenant: { id: 'tenant-1' },
    user: { sub: 'user-1' },
    isAdmin: true,
    permissions: {},
    path: probe.path,
    query: {},
    queryRunner: { manager: mg, isReleased: false },
  };
  req.ctx = { tenantId: 'tenant-1', userId: 'user-1', manager: mg, isAdmin: true, permissions: {} };
  let body: unknown;
  let queriesBeforeSend = -1;
  const res: any = {
    req,
    setHeader: (name: string, value: string) => { headers[name] = value; },
    getHeader: (name: string) => headers[Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase()) ?? ''],
    send: (value: unknown) => {
      body = value;
      queriesBeforeSend = queries.length;
    },
  };
  req.res = res;
  const controller = controllerWith(probe, seen);
  const context = {
    getType: () => 'http',
    getClass: () => probe.type,
    getHandler: () => probe.type.prototype[probe.handler],
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as any;
  let error: any = null;
  try {
    await lastValueFrom(
      new ExportEventsInterceptor().intercept(context, { handle: () => defer(() => probe.call(controller, format, scope, req, res)) }),
      { defaultValue: undefined },
    );
  } catch (caught) {
    error = caught;
  }
  const update = queries.find((query) => query.sql.startsWith('UPDATE audit_log'));
  return { headers, queries, seen, body, error, update, queriesBeforeSend };
}

async function testRoutes() {
  for (const probe of probes) {
    const xlsx = await run(probe, 'xlsx');
    assert.equal(xlsx.error, null, `${probe.name}: xlsx answers (${xlsx.error?.message})`);
    assert.equal(formatOf(xlsx.seen[0] ?? []), 'xlsx', `${probe.name}: the service gets the format`);
    assert.equal(xlsx.headers['Content-Type'], XLSX_CONTENT_TYPE, `${probe.name}: xlsx type`);
    assert.match(xlsx.headers['Content-Disposition'], /probe\.xlsx/, `${probe.name}: xlsx name`);
    assert.ok(Buffer.isBuffer(xlsx.body), `${probe.name}: a workbook`);
    assert.deepEqual(xlsx.update?.params, ['{"format":"xlsx","rows":3}', 'row-1', 'tenant-1'], `${probe.name}: format and rows on the audit row`);
    assert.equal(xlsx.queriesBeforeSend, xlsx.queries.length, `${probe.name}: the audit row is completed before sending`);

    const csv = await run(probe, undefined);
    assert.equal(csv.error, null, `${probe.name}: csv answers`);
    assert.equal(formatOf(csv.seen[0] ?? []), 'csv', `${probe.name}: csv by default`);
    assert.equal(csv.headers['Content-Type'], 'text/csv; charset=utf-8', `${probe.name}: csv type`);
    assert.match(csv.headers['Content-Disposition'], /probe\.csv/);
    assert.equal(typeof csv.body, 'string');
    assert.deepEqual(csv.update?.params, ['{"format":"csv","rows":3}', 'row-1', 'tenant-1'], `${probe.name}: csv on the audit row`);

    const refusals: Array<[string, 'data' | 'template']> = [['ods', 'data']];
    if (probe.template !== false) {
      const template = await run(probe, 'csv', 'template');
      assert.equal(template.error, null, `${probe.name}: the CSV template answers`);
      assert.deepEqual(template.update?.params, ['{"format":"csv","rows":0}', 'row-1', 'tenant-1'], `${probe.name}: a template has no row`);
      refusals.push(['xlsx', 'template'], ['XLSX ', 'template']);
    }
    for (const [format, scope] of refusals) {
      const refused = await run(probe, format, scope);
      assert.equal(refused.error?.getStatus?.(), 400, `${probe.name}: ${format} ${scope} answers 400`);
      assert.equal(refused.seen.length, 0, `${probe.name}: ${format} ${scope} refused before any work`);
      assert.equal(refused.body, undefined);
    }
  }
  console.log(`  ${probes.length} routes: format to the service, type, name, audit format and rows before sending; template xlsx and unknown format 400: OK`);
}

async function main() {
  console.log('list export routes');
  testCells();
  await testRoutes();
  console.log('list-export-routes.spec: all assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
