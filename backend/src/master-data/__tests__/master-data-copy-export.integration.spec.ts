// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import AdmZip = require('adm-zip');
import { BadRequestException } from '@nestjs/common';
import { from, lastValueFrom } from 'rxjs';
import type { EntityManager, QueryRunner } from 'typeorm';
import { ExportEventsInterceptor } from '../../audit/export-events.interceptor';
import { backendPath } from '../../common/__tests__/backend-root';
import { RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY } from '../../data-access/reserved-operations';
import { assert, inRolledBackTransaction, realFreeze, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { MasterDataOperationsController } from '../master-data-operations.controller';
import { MasterDataOperationsService } from '../master-data-operations.service';
// The screen's own rule for the words of a row.
import { masterDataCopyName, masterDataCopyStatus } from '../../../../frontend/src/pages/admin/master-data/masterDataCopyRows';

/**
 * The export of "Copy yearly metrics" (`GET /master-data-operations/copy/export`) against what the page
 * shows for the same parameters: the dry run it calls, each row worded by the frontend's
 * `masterDataCopyRows.ts` with the English words of `master-data.json` and `ops.json`, in the dry run's
 * order. Then the refused requests (400), the reservation the route shares with the copy, and the audit
 * row with the format and the row count. One rolled-back transaction per case.
 */

const SOURCE = 2031;
const DESTINATION = SOURCE + 1;
const locale = (ns: string) => JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', 'en', `${ns}.json`), 'utf8'));
const MD = locale('master-data');
const OPS = locale('ops');
const word = (json: any, key: string): string => key.split('.').reduce<any>((node, part) => node?.[part], json);
const METRIC_KEYS: Record<string, string> = { headcount: 'headcount', it_users: 'itUsers', turnover: 'turnover' };

type World = { tenantId: string; userId: string };

function controller() {
  const svc = new MasterDataOperationsService(
    undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, realFreeze() as any,
  );
  return { svc, http: new MasterDataOperationsController(svc) };
}

/**
 * Companies "Alpha" (both years), "Beta" (the source year only, a turnover with decimals), a nameless
 * company (the destination year only: nothing to copy) and two departments of Alpha (one with a source
 * headcount, one without); an administrator.
 */
async function seedWorld(runner: QueryRunner): Promise<World> {
  const tenantId = await seedTenant(runner, 'mdexport');
  const company = async (name: string) => (await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`, [tenantId, name],
  ))[0].id as string;
  const metrics = (companyId: string, year: number, headcount: number, itUsers: number, turnover: string) => runner.query(
    `INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, it_users, turnover) VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, companyId, year, headcount, itUsers, turnover],
  );
  const alpha = await company('Alpha');
  await metrics(alpha, SOURCE, 120, 80, '15.5');
  await metrics(alpha, DESTINATION, 100, 70, '12');
  const beta = await company('Beta');
  await metrics(beta, SOURCE, 40, 25, '3.125');
  const nameless = await company(' ');
  await metrics(nameless, DESTINATION, 5, 5, '1');
  const department = async (name: string, headcount: number | null) => {
    const [{ id }] = await runner.query(`INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, $3) RETURNING id`, [tenantId, alpha, name]);
    if (headcount !== null) {
      await runner.query(
        `INSERT INTO department_metrics (id, tenant_id, department_id, fiscal_year, headcount, is_frozen, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, false, now(), now())`,
        [randomUUID(), tenantId, id, SOURCE, headcount],
      );
    }
    if (headcount === null) {
      await runner.query(
        `INSERT INTO department_metrics (id, tenant_id, department_id, fiscal_year, headcount, is_frozen, created_at, updated_at) VALUES ($1, $2, $3, $4, 3, false, now(), now())`,
        [randomUUID(), tenantId, id, DESTINATION],
      );
    }
  };
  await department('Finance', 12);
  await department('Legal', null);
  const [{ id: roleId }] = await runner.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Copy admin') RETURNING id`, [tenantId]);
  const [{ id: userId }] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Copy', 'Export', $3, 'enabled') RETURNING id`,
    [tenantId, roleId, `md-export-${randomUUID()}@example.invalid`],
  );
  return { tenantId, userId };
}

function ctxOf(m: EntityManager, w: World) {
  return { tenantId: w.tenantId, userId: w.userId, userRoles: [], isAdmin: true, permissions: {}, manager: m };
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

async function exportFile(m: EntityManager, w: World, query: Record<string, unknown>) {
  const out = response({ query });
  await controller().http.exportCopy(query, ctxOf(m, w) as any, out.res);
  return out;
}

/** The rows of an English CSV (BOM dropped, quotes read). */
function csvRows(buffer: Buffer): string[][] {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** The page's table for its parameters: the dry run's rows, worded by the page's rule. */
async function screen(m: EntityManager, w: World, p: { includeCompanies: boolean; includeDepartments: boolean; companyMetrics: string[] }) {
  const dry = await controller().svc.copyMasterData({
    sourceYear: SOURCE,
    destinationYear: DESTINATION,
    ...p,
    dryRun: true,
    userId: w.userId,
    access: { isAdmin: true, permissions: {} },
  }, { manager: m });
  const value = (n: number | null) => (n == null ? '' : String(Number(n)));
  return [
    ['type', 'name', 'metric', 'sourceValue', 'currentDestination', 'newValue', 'status'].map((key) => word(MD, `admin.copy.columns.${key}`)),
    ...dry.results.map((row) => [
      word(MD, `admin.copy.entityTypes.${row.entityType}`),
      masterDataCopyName(row, { unknownCompany: word(OPS, 'reports.shared.unknownCompany'), unknownDepartment: word(OPS, 'reports.shared.unknownDepartment') }),
      word(MD, `admin.copy.metrics.${METRIC_KEYS[row.metric]}`),
      value(row.sourceValue),
      value(row.destinationValue),
      value(row.newValue),
      word(MD, `admin.copy.status.${masterDataCopyStatus(row)}`),
    ]),
  ];
}

async function testRows() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const cases = [
      { includeCompanies: true, includeDepartments: true, companyMetrics: ['headcount', 'it_users', 'turnover'] },
      { includeCompanies: true, includeDepartments: false, companyMetrics: ['turnover'] },
      { includeCompanies: false, includeDepartments: true, companyMetrics: [] },
    ];
    for (const p of cases) {
      const out = await exportFile(runner.manager, w, {
        sourceYear: String(SOURCE),
        destinationYear: String(DESTINATION),
        includeCompanies: String(p.includeCompanies),
        includeDepartments: String(p.includeDepartments),
        ...(p.companyMetrics.length ? { companyMetrics: p.companyMetrics.join(',') } : {}),
        format: 'csv',
        language: 'en',
      });
      const expected = await screen(runner.manager, w, p);
      assert.ok(expected.length > 2, `${JSON.stringify(p)}: rows to compare`);
      assert.deepEqual(csvRows(out.body()), expected, `${JSON.stringify(p)}: the preview table`);
    }
    const all = csvRows((await exportFile(runner.manager, w, {
      sourceYear: String(SOURCE), destinationYear: String(DESTINATION), includeCompanies: 'true', includeDepartments: 'true', companyMetrics: 'turnover', format: 'csv', language: 'en',
    })).body());
    assert.deepEqual(all.slice(1).map((row) => [row[1], row[5], row[6]]), [
      ['Unknown company', '', 'No data for source year'],
      ['Alpha', '15.5', 'Ready to copy'],
      ['Beta', '3.125', 'Ready to copy'],
      ['Finance (Alpha)', '12', 'Ready to copy'],
      ['Legal (Alpha)', '', 'No data for source year'],
    ], 'names, values and statuses as the page shows them');

    const xlsx = await exportFile(runner.manager, w, {
      sourceYear: String(SOURCE), destinationYear: String(DESTINATION), includeCompanies: 'true', includeDepartments: 'false', companyMetrics: 'headcount,it_users', format: 'xlsx', language: 'de',
    });
    const zip = new AdmZip(xlsx.body());
    assert.deepEqual([...zip.readAsText('xl/workbook.xml').matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]), ['Datenvorschau', 'Parameter']);
    const parameters = zip.readAsText('xl/worksheets/sheet2.xml');
    for (const text of ['Quelljahr', String(SOURCE), 'Unternehmen', 'Mitarbeiterzahl']) assert.ok(parameters.includes(text), `Parameters sheet: ${text}`);
  });
  console.log('  rows: the export equals the preview table for companies, departments and both');
}

async function testRefused() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const base = { sourceYear: String(SOURCE), destinationYear: String(DESTINATION), includeCompanies: 'true', includeDepartments: 'false', companyMetrics: 'headcount' };
    const refusals: Array<[Record<string, unknown>, RegExp]> = [
      [{ ...base, dryRun: 'false' }, /Unknown parameter: dryRun/],
      [{ ...base, companyMetrics: ['headcount', 'turnover'] }, /companyMetrics must be given once/],
      [{ ...base, sourceYear: 'last' }, /sourceYear must be a year/],
      [{ ...base, includeCompanies: '1' }, /includeCompanies must be true or false/],
      [{ ...base, companyMetrics: 'margin' }, /Unsupported company metric/],
      [{ ...base, includeCompanies: 'false' }, /At least one data source/],
      [{ ...base, companyMetrics: undefined }, /Select at least one company metric/],
    ];
    for (const [query, message] of refusals) {
      await runner.query('SAVEPOINT refused');
      await assert.rejects(() => exportFile(runner.manager, w, query), (err: unknown) => err instanceof BadRequestException && message.test(JSON.stringify((err as BadRequestException).getResponse())), JSON.stringify(query));
      await runner.query('ROLLBACK TO SAVEPOINT refused');
    }
  });
  console.log('  refused: unknown and repeated parameters, invalid values, an impossible copy (400)');
}

/** The export carries the reservation of the copy: a limited person is refused on both (data-access-reserved-routes.spec). */
async function testReserved() {
  const reserved = (target: object) => Reflect.getMetadata(RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY, target) === true;
  assert.ok(reserved(MasterDataOperationsController.prototype.copy), 'the copy is reserved');
  assert.ok(reserved(MasterDataOperationsController.prototype.exportCopy), 'its export is reserved');
  console.log('  reserved: the export carries the reservation of the copy');
}

async function testAudit() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const m = runner.manager;
    const path = '/master-data-operations/copy/export';
    const query = { sourceYear: String(SOURCE), destinationYear: String(DESTINATION), includeCompanies: 'true', includeDepartments: 'true', companyMetrics: 'headcount,turnover', format: 'xlsx', language: 'en' };
    const req = { queryRunner: { manager: m, isReleased: false }, tenant: { id: w.tenantId }, user: { sub: w.userId }, query, path };
    const out = response(req);
    const { http } = controller();
    const context: any = {
      getType: () => 'http',
      getClass: () => MasterDataOperationsController,
      getHandler: () => MasterDataOperationsController.prototype.exportCopy,
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => out.res }),
    };
    const call = () => from(http.exportCopy(query, ctxOf(m, w) as any, out.res) as Promise<void>);
    await lastValueFrom(new ExportEventsInterceptor().intercept(context, { handle: call }), { defaultValue: undefined });
    const rows: Array<{ after: any }> = await m.query(
      `SELECT after_json AS after FROM audit_log WHERE tenant_id = $1 AND table_name = 'export' AND after_json->>'path' = $2`,
      [w.tenantId, path],
    );
    assert.equal(rows.length, 1, 'one export row');
    // Three companies by two metrics, two departments.
    assert.deepEqual({ format: rows[0].after.format, rows: rows[0].after.rows }, { format: 'xlsx', rows: 8 });
  });
  console.log('  audit: the export row carries the format and the row count');
}

void runSpecs('master-data-copy-export.integration.spec', [
  ['rows', testRows],
  ['refused', testRefused],
  ['reserved', testReserved],
  ['audit', testAudit],
]);
