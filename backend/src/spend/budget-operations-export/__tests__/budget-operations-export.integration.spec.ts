// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import AdmZip = require('adm-zip');
import { BadRequestException } from '@nestjs/common';
import { from, lastValueFrom } from 'rxjs';
import type { EntityManager, QueryRunner } from 'typeorm';
import { ExportEventsInterceptor } from '../../../audit/export-events.interceptor';
import { backendPath } from '../../../common/__tests__/backend-root';
import { RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY } from '../../../data-access/reserved-operations';
import { AllocationCalculatorService } from '../../allocation-calculator.service';
import { budgetListAccess } from '../../budget-list/budget-list.runtime';
import { BudgetLinesController } from '../../budget-lines.controller';
import { BudgetLinesService } from '../../budget-lines.service';
import { SpendBudgetOperationsService } from '../../spend-budget-operations.service';
import { CapexItemsService, SpendItemsService } from '../../spend-items.service';
import { realSummaryDeps } from '../../__tests__/oracle/oracle-deps';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  realFreeze,
  repeat,
  runSpecs,
  seedItem,
  seedMonths,
  seedTenant,
  seedVersion,
  type Kind,
} from '../../__tests__/round-inputs.fixtures';
import { BudgetOperationsExportController } from '../budget-operations-export.controller';
import { BudgetOperationsExportService } from '../budget-operations-export.service';
// The screens' own code: the requests they send, how they read the answers, how they join the copy.
import * as R from '../../../../../frontend/src/pages/reports/reportAggregates';
import * as C from '../../../../../frontend/src/pages/operations/copyBudgetRows';

/**
 * The budget operations exports (`GET /budget-lines/budget-operations/{clear-column,copy}/export`) against
 * what the pages show for the same parameters: the aggregate route's answer (its service call) read by the
 * frontend's `reportAggregates.ts`, and for the copy the dry run the page calls joined by the frontend's
 * `copyBudgetRows.ts`, worded with the English words of `ops.json`, in the grid's default order. Then the
 * refused requests (400), the reservation the routes share with the operations, and the audit row with the
 * format and the row count. One rolled-back transaction per case.
 */

const YEAR = 2031;
const NEXT = YEAR + 1;
const OPS = JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', 'en', 'ops.json'), 'utf8'));
const word = (key: string): string => key.split('.').reduce<any>((node, part) => node?.[part], OPS);
/** i18next's interpolation of the page's `t`. */
const fill = (key: string, values: Record<string, unknown> = {}): string =>
  Object.entries(values).reduce((text, [name, value]) => text.split(`{{${name}}}`).join(String(value)), word(key));
/** `allocationMethodLabel` of the page (`frontend/src/utils/allocationLabels.ts`), in English. */
const METHOD_KEYS: Record<string, string> = {
  headcount: 'opex.allocations.headcount',
  it_users: 'opex.allocations.itUsers',
  turnover: 'opex.allocations.turnover',
  manual_company: 'opex.allocations.manualByCompany',
  manual_department: 'opex.allocations.manualByDepartment',
  manual_pct: 'opex.allocations.manualByPct',
  default: 'reports.shared.allocationMethodDefault',
};
const methodWord = (method: string | null | undefined) => (method && METHOD_KEYS[method] ? word(METHOD_KEYS[method]) : method ?? '');
const amountText = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

type World = { tenantId: string; userId: string };

function services() {
  const deps = realSummaryDeps({ scope: 'opex' });
  const item = (Service: any) => {
    const args: any[] = Array.from({ length: 11 }, () => undefined);
    args[4] = deps.allocationCalculator;
    args[6] = deps.fxRates;
    return new Service(...args);
  };
  const opex: SpendItemsService = item(SpendItemsService);
  const capex: CapexItemsService = item(CapexItemsService);
  const lines: BudgetLinesService = new (BudgetLinesService as any)(deps.allocationCalculator, deps.fxRates, undefined, undefined, opex, capex, undefined);
  const calculator = new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any);
  const operations = new SpendBudgetOperationsService(undefined as any, undefined as any, undefined as any, undefined as any, captureAudit() as any, realFreeze() as any, calculator);
  return { opex, capex, lines, operations, controller: new BudgetOperationsExportController(new BudgetOperationsExportService(opex, capex, lines, operations)) };
}

async function seedYear(runner: QueryRunner, kind: Kind, w: { tenantId: string }, itemId: string, year: number, monthly: string, method: string, rows: Array<[string, number]> = []) {
  const versionId = await seedVersion(runner, kind, w.tenantId, itemId, year, 'annual');
  await seedMonths(runner, kind, w.tenantId, versionId, year, { planned: repeat(monthly, 12) });
  await runner.query(`UPDATE spend_versions SET allocation_method = $2 WHERE id = $1`, [versionId, method]);
  for (const [companyId, pct] of rows) {
    await runner.query(
      `INSERT INTO spend_allocations (tenant_id, version_id, company_id, allocation_pct, is_system_generated) VALUES ($1, $2, $3, $4, false)`,
      [w.tenantId, versionId, companyId, pct],
    );
  }
}

/**
 * Lines of both natures with every status of the copy: OPEX "Manual" (YEAR only, a manual split),
 * "Filled" (both years hold amounts and a split), "Automatic" (headcount, then IT users without a manual
 * row), CAPEX "Equipment" (YEAR, a manual split) and "Next only" (NEXT only). Two companies with metrics,
 * an administrator for the audit row.
 */
async function seedWorld(runner: QueryRunner): Promise<World> {
  const tenantId = await seedTenant(runner, 'opsexport');
  const w = { tenantId };
  const company = async (name: string) => {
    const [{ id }] = await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`, [tenantId, name]);
    for (const year of [YEAR, NEXT]) {
      await runner.query(`INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount) VALUES ($1, $2, $3, 10)`, [tenantId, id, year]);
    }
    return id as string;
  };
  const north = await company('North');
  const south = await company('South');
  const manual = await seedItem(runner, 'opex', tenantId, 1, 'Manual');
  await seedYear(runner, 'opex', w, manual, YEAR, '100', 'manual_pct', [[north, 60], [south, 40]]);
  const filled = await seedItem(runner, 'opex', tenantId, 2, 'Filled');
  await seedYear(runner, 'opex', w, filled, YEAR, '50', 'manual_pct', [[north, 100]]);
  await seedYear(runner, 'opex', w, filled, NEXT, '70', 'manual_pct', [[south, 100]]);
  const automatic = await seedItem(runner, 'opex', tenantId, 3, 'Automatic');
  await seedYear(runner, 'opex', w, automatic, YEAR, '10.25', 'headcount');
  await seedYear(runner, 'opex', w, automatic, NEXT, '0', 'it_users');
  const equipment = await seedItem(runner, 'capex', tenantId, 1, 'Equipment');
  await seedYear(runner, 'capex', w, equipment, YEAR, '1000', 'manual_pct', [[south, 100]]);
  const nextOnly = await seedItem(runner, 'capex', tenantId, 2, 'Next only');
  await seedYear(runner, 'capex', w, nextOnly, NEXT, '5', 'default');
  const [{ id: roleId }] = await runner.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Export admin') RETURNING id`, [tenantId]);
  const [{ id: userId }] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Ops', 'Export', $3, 'enabled') RETURNING id`,
    [tenantId, roleId, `ops-export-${randomUUID()}@example.invalid`],
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

type Route = 'clearColumn' | 'copy';
const PATH: Record<Route, string> = { clearColumn: 'clear-column', copy: 'copy' };

async function exportFile(m: EntityManager, w: World, route: Route, query: Record<string, unknown>) {
  const out = response({ query });
  await (services().controller as any)[route](query, ctxOf(m, w), out.res);
  return out;
}

/** The rows of a CSV the export writes (BOM dropped, quotes read). */
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

/** What the page's aggregate answers for a request (the aggregate route's service call). */
async function screenAnswer(m: EntityManager, w: World, scope: R.BudgetScope, request: R.AggregateRequest): Promise<R.AggregateResult> {
  const svc = services();
  const opts = { manager: m, access: budgetListAccess(ctxOf(m, w)) };
  const answer = scope === 'all'
    ? await svc.lines.summaryAggregateRequest(request, opts)
    : await (scope === 'capex' ? svc.capex : svc.opex).summaryAggregateRequest(request, opts);
  return answer as unknown as R.AggregateResult;
}

const natureWord = (nature: string | null) => (nature ? word(`operations.scope.${nature}`) : '');

async function testColumnReset() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    for (const [scope, year] of [['all', YEAR], ['opex', NEXT], ['capex', YEAR]] as Array<[R.BudgetScope, number]>) {
      const lines = R.readOperationLines(await screenAnswer(runner.manager, w, scope, R.operationLinesRequest(scope, [year], [{ id: 'current', year, metric: 'budget' }])), scope);
      // The grid's default order: the amount, largest first; AG Grid keeps the row order between equals.
      const shown = lines.map((line) => ({ line, value: line.values.current ?? 0 })).sort((a, b) => b.value - a.value);
      const expected = [
        [word('operations.columnReset.product'), ...(scope === 'all' ? [word('operations.scope.label')] : []), fill('operations.columnReset.currentHeader', { column: 'Budget', year })],
        ...shown.map(({ line, value }) => [line.name, ...(scope === 'all' ? [natureWord(line.nature)] : []), amountText(value)]),
      ];
      const out = await exportFile(runner.manager, w, 'clearColumn', { scope, year: String(year), column: 'budget', format: 'csv', language: 'en' });
      assert.deepEqual(csvRows(out.body()), expected, `reset ${scope} ${year}: the grid`);
      assert.match(out.headers['Content-Disposition'], new RegExp(`column-reset-${scope}-${year}-budget-\\d{4}-\\d{2}-\\d{2}\\.csv`));
    }
    const all = csvRows((await exportFile(runner.manager, w, 'clearColumn', { scope: 'all', year: String(YEAR), column: 'budget', format: 'csv', language: 'en' })).body());
    assert.deepEqual(all.slice(1).map((row) => row[0]), ['Equipment', 'Manual', 'Filled', 'Automatic', 'Next only'], 'all lines, largest first');
    assert.deepEqual(all[1], ['Equipment', 'CAPEX', '12000.00']);
  });
  console.log('  column reset: the export equals the grid for all lines and each nature');
}

/** The copy page's table for its parameters: the window and the dry run joined, worded, in the grid's order. */
async function copyScreen(m: EntityManager, w: World, p: { scope: R.BudgetScope; amounts: boolean; allocations: boolean; overwrite: boolean; pct: number }) {
  const svc = services();
  const window = await screenAnswer(m, w, p.scope, R.operationLinesRequest(
    p.scope,
    [YEAR, NEXT],
    p.amounts ? [{ id: 'source', year: YEAR, metric: 'budget' }, { id: 'destination', year: NEXT, metric: 'budget' }] : [],
  ));
  const dry = await svc.operations.copyBudget({
    scope: p.scope,
    sourceYear: YEAR,
    destinationYear: NEXT,
    amounts: p.amounts ? { sourceColumn: 'budget', destinationColumn: 'budget', percentageIncrease: p.pct } : null,
    allocations: p.allocations,
    overwrite: p.overwrite,
    dryRun: true,
  }, w.userId, { manager: m });
  const joined = C.copyBudgetRows(R.readOperationLines(window, p.scope), dry.results as any);
  const rows = p.amounts ? [...joined].sort((a, b) => b.sourceValue - a.sourceValue) : joined;
  const context = { done: false, sourceYear: YEAR, destinationYear: NEXT };
  const said = (status: C.CopyStatus | null) => {
    if (!status) return '';
    const values: Record<string, unknown> = {};
    if (status.year !== undefined) values.year = status.year;
    if (status.method !== undefined) values.method = methodWord(status.method);
    if (status.message !== undefined) values.message = status.message;
    return fill(`operations.copyBudget.status.${status.key}`, values);
  };
  const method = (row: (typeof rows)[number], pick: (part: C.CopyAllocationsAnswer) => string | null) => (row.allocations ? methodWord(pick(row.allocations)) : '');
  return [
    [
      word('operations.copyBudget.line'),
      ...(p.scope === 'all' ? [word('operations.scope.label')] : []),
      ...(p.amounts ? [
        fill('operations.copyBudget.sourceHeader', { column: 'Budget', year: YEAR }),
        fill('operations.copyBudget.currentHeader', { column: 'Budget', year: NEXT }),
        fill('operations.copyBudget.afterHeader', { column: 'Budget', year: NEXT }),
        word('operations.copyBudget.amountsStatus'),
      ] : []),
      ...(p.allocations ? [
        fill('operations.copyBudget.allocationSource', { year: YEAR }),
        fill('operations.copyBudget.allocationCurrent', { year: NEXT }),
        fill('operations.copyBudget.allocationAfter', { year: NEXT }),
        word('operations.copyBudget.allocationsStatus'),
      ] : []),
    ],
    ...rows.map((row) => [
      row.name,
      ...(p.scope === 'all' ? [natureWord(row.nature)] : []),
      ...(p.amounts ? [amountText(row.sourceValue), amountText(row.destinationValue), amountText(C.copyAfterValue(row)), said(C.copyAmountsStatus(row, context))] : []),
      ...(p.allocations ? [
        method(row, (part) => part.sourceMethod),
        method(row, (part) => part.destinationMethod),
        method(row, (part) => part.resultMethod),
        said(C.copyAllocationsStatus(row, context)),
      ] : []),
    ]),
  ];
}

async function testCopy() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const cases = [
      { scope: 'all', amounts: true, allocations: true, overwrite: false, pct: 5 },
      { scope: 'opex', amounts: true, allocations: false, overwrite: true, pct: 2.5 },
      { scope: 'capex', amounts: false, allocations: true, overwrite: false, pct: 0 },
    ] as const;
    for (const p of cases) {
      const query: Record<string, unknown> = {
        scope: p.scope,
        sourceYear: String(YEAR),
        destinationYear: String(NEXT),
        amounts: String(p.amounts),
        allocations: String(p.allocations),
        ...(p.amounts ? { sourceColumn: 'budget', destinationColumn: 'budget', percentageIncrease: String(p.pct) } : {}),
        overwrite: String(p.overwrite),
        format: 'csv',
        language: 'en',
      };
      const out = await exportFile(runner.manager, w, 'copy', query);
      const expected = await copyScreen(runner.manager, w, { ...p });
      assert.deepEqual(csvRows(out.body()), expected, `copy ${JSON.stringify(p)}: the preview grid`);
      assert.ok(expected.length > 2, `copy ${p.scope}: lines to compare`);
    }
    // The statuses the case with both parts shows, as the page words them.
    const both = csvRows((await exportFile(runner.manager, w, 'copy', {
      scope: 'all', sourceYear: String(YEAR), destinationYear: String(NEXT), amounts: 'true', allocations: 'true',
      sourceColumn: 'budget', destinationColumn: 'budget', percentageIncrease: '5', overwrite: 'false', format: 'csv', language: 'en',
    })).body());
    const byName = new Map(both.slice(1).map((row) => [row[0], row]));
    const manualPct = methodWord('manual_pct');
    assert.deepEqual(byName.get('Manual'), ['Manual', 'OPEX', '1200.00', '0.00', '1260.00', 'To copy', manualPct, '', manualPct, 'To copy']);
    assert.equal(byName.get('Filled')![5], word('operations.copyBudget.status.destinationFilled'));
    assert.equal(byName.get('Automatic')![9], fill('operations.copyBudget.status.replaces', { method: methodWord('it_users') }));

    // The workbook: the preview sheet, then the parameters in words.
    const xlsx = await exportFile(runner.manager, w, 'copy', {
      scope: 'opex', sourceYear: String(YEAR), destinationYear: String(NEXT), amounts: 'true', allocations: 'false',
      sourceColumn: 'budget', destinationColumn: 'budget', percentageIncrease: '2.5', overwrite: 'true', format: 'xlsx', language: 'fr',
    });
    const zip = new AdmZip(xlsx.body());
    const sheets = [...zip.readAsText('xl/workbook.xml').matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(sheets, ['Aperçu', 'Paramètres']);
    const parameters = zip.readAsText('xl/worksheets/sheet2.xml');
    for (const text of ['Type de ligne', 'OPEX', 'Année source', 'Montants', '2,5%', 'Écraser les données existantes', 'Oui']) {
      assert.ok(parameters.includes(text), `Parameters sheet: ${text}`);
    }
  });
  console.log('  copy: the export equals the preview grid (window and dry run joined), statuses worded as the page');
}

async function testRefused() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const copy = { scope: 'all', sourceYear: String(YEAR), destinationYear: String(NEXT), amounts: 'true', allocations: 'false', sourceColumn: 'budget', destinationColumn: 'budget' };
    const refusals: Array<[Route, Record<string, unknown>, RegExp]> = [
      ['clearColumn', { scope: 'all', year: String(YEAR), column: 'budget', group: 'x' }, /Unknown parameter: group/],
      ['clearColumn', { scope: 'all', year: [String(YEAR), String(NEXT)], column: 'budget' }, /year must be given once/],
      ['clearColumn', { scope: 'all', year: String(YEAR) }, /column is required/],
      ['clearColumn', { scope: 'both', year: String(YEAR), column: 'budget' }, /scope must be/],
      ['clearColumn', { scope: 'all', year: 'soon', column: 'budget' }, /year must be a year/],
      ['copy', { ...copy, dryRun: 'false' }, /Unknown parameter: dryRun/],
      ['copy', { ...copy, amounts: 'false', allocations: 'true' }, /the amounts are not copied/],
      ['copy', { ...copy, percentageIncrease: '5,5' }, /percentageIncrease must be a decimal number/],
      ['copy', { ...copy, sourceColumn: 'plan' }, /sourceColumn must be one of/],
      ['copy', { ...copy, overwrite: 'yes' }, /overwrite must be true or false/],
      ['copy', { scope: 'all', sourceYear: String(YEAR), destinationYear: String(YEAR), amounts: 'false', allocations: 'true' }, /Allocations belong to a year/],
      ['copy', { scope: 'all', sourceYear: String(YEAR), destinationYear: String(NEXT), amounts: 'false', allocations: 'false' }, /Choose what to copy/],
    ];
    for (const [route, query, message] of refusals) {
      await runner.query('SAVEPOINT refused');
      await assert.rejects(() => exportFile(runner.manager, w, route, query), (err: unknown) => err instanceof BadRequestException && message.test(JSON.stringify((err as BadRequestException).getResponse())), `${route} ${JSON.stringify(query)}`);
      await runner.query('ROLLBACK TO SAVEPOINT refused');
    }
  });
  console.log('  refused: unknown and repeated parameters, invalid values, an impossible copy (400)');
}

/** The exports carry the reservation of the operations they preview: a limited person is refused on both (data-access-reserved-routes.spec). */
async function testReserved() {
  const reserved = (target: object) => Reflect.getMetadata(RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY, target) === true;
  assert.ok(reserved(BudgetLinesController.prototype.copyBudget) && reserved(BudgetLinesController.prototype.clearBudgetColumn), 'the operations are reserved');
  assert.ok(reserved(BudgetOperationsExportController.prototype.copy), 'the copy export is reserved');
  assert.ok(reserved(BudgetOperationsExportController.prototype.clearColumn), 'the reset export is reserved');
  console.log('  reserved: both exports carry the reservation of the operations');
}

async function testAudit() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const m = runner.manager;
    const cases: Array<[Route, Record<string, unknown>, number]> = [
      ['clearColumn', { scope: 'all', year: String(YEAR), column: 'budget', format: 'csv', language: 'en' }, 5],
      ['copy', { scope: 'opex', sourceYear: String(YEAR), destinationYear: String(NEXT), amounts: 'true', allocations: 'true', sourceColumn: 'budget', destinationColumn: 'budget', percentageIncrease: '0', overwrite: 'false', format: 'xlsx', language: 'en' }, 3],
    ];
    const svc = services();
    for (const [route, query, count] of cases) {
      const path = `/budget-lines/budget-operations/${PATH[route]}/export`;
      const req = { queryRunner: { manager: m, isReleased: false }, tenant: { id: w.tenantId }, user: { sub: w.userId }, query, path };
      const out = response(req);
      const context: any = {
        getType: () => 'http',
        getClass: () => BudgetOperationsExportController,
        getHandler: () => (BudgetOperationsExportController.prototype as any)[route],
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => out.res }),
      };
      const call = () => from((svc.controller as any)[route](query, ctxOf(m, w), out.res) as Promise<void>);
      await lastValueFrom(new ExportEventsInterceptor().intercept(context, { handle: call }), { defaultValue: undefined });
      const rows: Array<{ after: any }> = await m.query(
        `SELECT after_json AS after FROM audit_log WHERE tenant_id = $1 AND table_name = 'export' AND after_json->>'path' = $2`,
        [w.tenantId, path],
      );
      assert.equal(rows.length, 1, `${route}: one export row`);
      assert.deepEqual({ format: rows[0].after.format, rows: rows[0].after.rows }, { format: query.format, rows: count }, route);
    }
  });
  console.log('  audit: the export row carries the format and the row count');
}

void runSpecs('budget-operations-export.integration.spec', [
  ['column reset', testColumnReset],
  ['copy', testCopy],
  ['refused', testRefused],
  ['reserved', testReserved],
  ['audit', testAudit],
]);
