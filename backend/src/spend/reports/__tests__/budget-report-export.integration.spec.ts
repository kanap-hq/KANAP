// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import AdmZip = require('adm-zip');
import { lastValueFrom, from } from 'rxjs';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../../data-source';
import { ExportEventsInterceptor } from '../../../audit/export-events.interceptor';
import { applyDataAccess, DATA_ACCESS_HEADER } from '../../../data-access/data-access';
import { LIMITED_ROLE, PgClient, roleExists } from '../../../data-access/__tests__/data-access-test-helpers';
import { Seed, seed } from '../../../data-access/__tests__/data-access-line-seed';
import { budgetListAccess } from '../../budget-list/budget-list.runtime';
import { BudgetLinesService } from '../../budget-lines.service';
import { CapexItemsService, SpendItemsService } from '../../spend-items.service';
import { realSummaryDeps } from '../../__tests__/oracle/oracle-deps';
import { BudgetReportExportController } from '../budget-report-export.controller';
import { BUDGET_REPORT_EXPORT_LABELS } from '../budget-report-export.labels';
import { BudgetReportExportService } from '../budget-report-export.service';
// The screens' own code: the requests they send and the tables they show.
import * as R from '../../../../../frontend/src/pages/reports/reportAggregates';
import * as T from '../../../../../frontend/src/pages/reports/reportTables';

/**
 * The budget report exports against what the screens compute, on the data-scoped access reference
 * example (`data-access-line-seed.ts`) with amounts for two years, declared FTE and a dimension value on
 * three lines, in one rolled-back transaction, each person in a savepoint after `applyDataAccess`.
 *
 * For each case, the expected table is the frontend files' (`frontend/src/pages/reports/`, imported
 * here) applied to the aggregate route's answer for the request the screen sends: the filter bar's
 * models built from the cost center subtree expanded as the browser does (a walk of the parent links),
 * independently of the server's recursive read. The file's sheet holds the same headers and rows, cells
 * as the file writes them, the totals as a footer row that each amount column adds up to. Then a person under data-scoped access (their lines only, the access line,
 * the header), refused requests, and the audit row with the row count.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });
const Y = new Date().getFullYear();
const L = BUDGET_REPORT_EXPORT_LABELS.en;
const COLUMN_NAMES: Record<R.MetricKey, string> = { budget: 'Budget', revision: 'Revision', forecast: 'Forecast', follow_up: 'Actuals', landing: 'Expected landing' };
const LABELS: T.ReportTableLabels = {
  columnNames: COLUMN_NAMES,
  columnFte: (column) => L.columnFte.replace('{{column}}', column),
  metric: L.metric,
  year: L.year,
  column: L.column,
  selection: L.selection,
  total: L.total,
  totalFte: L.totalFte,
  item: L.item,
  shareOfTotal: L.shareOfTotal,
  delta: L.delta,
  pctIncrease: L.pctIncrease,
  consolidationAccount: L.consolidationAccount,
  consolidationUnassigned: L.consolidationUnassigned,
  consolidationTotal: (metric) => L.consolidationTotal.replace('{{metric}}', metric),
  analyticsUnassigned: L.analyticsUnassigned,
  analyticsUnnamed: L.analyticsUnnamed,
  analyticsTotal: (metric) => L.analyticsTotal.replace('{{metric}}', metric),
  monthNames: T.shortMonthNames('en'),
  average: L.average,
  peak: L.peak,
};

type Fixture = Seed & {
  axis2Name: string;
  category2Name: string;
  /** The seed's first dimension and its value, held by every line. */
  axis1: string;
  category1: string;
  /** Hosting (L1, L2; consolidation line 60 Software) and Support (L3; 61 Services). */
  accounts: { hosting: string; support: string };
  costCenters: Array<{ id: string; parent_id: string | null }>;
};
/** `permissions` as `PermissionGuard` sets them; none: no accounts page, so no consolidation line. */
type Person = { id: string; isAdmin: boolean; permissions?: Record<string, string> };

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

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
  return { opex, capex, lines, controller: new BudgetReportExportController(new BudgetReportExportService(opex, capex, lines)) };
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

/** Amounts for Y and Y+1 on every line, declared FTE on three of them, a value of the second dimension on L1 to L3. */
async function enrich(runner: QueryRunner, s: Seed): Promise<Fixture> {
  const q = (sql: string, params: unknown[]) => runner.query(sql, params);
  const labels = Object.keys(s.lines) as Array<keyof Seed['lines']>;
  for (const [index, label] of labels.entries()) {
    const line = s.lines[label];
    for (const year of [Y, Y + 1]) {
      let version: string | undefined = (await q(`SELECT id FROM spend_versions WHERE tenant_id = $1 AND spend_item_id = $2 AND budget_year = $3`, [s.tenantId, line, year]))[0]?.id;
      if (!version) {
        version = (await q(
          `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [s.tenantId, line, `Budget ${year}`, `${year}-01-01`, year],
        ))[0].id as string;
      }
      await q(`DELETE FROM spend_amounts WHERE tenant_id = $1 AND version_id = $2`, [s.tenantId, version]);
      // Distinct values with cents, so an order or a rounding slip shows.
      const planned = year === Y ? 100 * (index + 1) + 0.25 : 50 * (7 - index) + 0.5;
      await q(`INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, $3, $4)`, [s.tenantId, version, `${year}-01-01`, planned]);
      if (year === Y && index < 3) {
        const round = (await q(`SELECT id FROM spend_round_inputs WHERE tenant_id = $1 AND version_id = $2 AND measure = 'planned'`, [s.tenantId, version]))[0]?.id;
        if (round) await q(`UPDATE spend_round_inputs SET fte = $3 WHERE tenant_id = $1 AND id = $2`, [s.tenantId, round, 0.5 * (index + 1)]);
        else {
          await q(
            `INSERT INTO spend_round_inputs (tenant_id, version_id, measure, period_start, period_end, method, fte) VALUES ($1, $2, 'planned', $3, $4, 'manual', $5)`,
            [s.tenantId, version, `${year}-01-01`, `${year}-12-31`, 0.5 * (index + 1)],
          );
        }
      }
    }
    if (index < 3) {
      await q(`INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`, [s.tenantId, line, s.axis2, s.category2]);
    }
  }
  const axis2Name = (await q(`SELECT name FROM analytics_axes WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.axis2]))[0].name as string;
  const category2Name = (await q(`SELECT name FROM analytics_categories WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.category2]))[0].name as string;
  const costCenters = await q(`SELECT id, parent_id FROM cost_centers WHERE tenant_id = $1`, [s.tenantId]);
  const first = (await q(
    `SELECT axis_id, category_id FROM spend_item_analytics_values WHERE tenant_id = $1 AND item_id = $2 AND axis_id <> $3`,
    [s.tenantId, s.lines.L1, s.axis2],
  ))[0];
  const chart = (await q(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'XR', 'Export chart', 'FR') RETURNING id`, [s.tenantId]))[0].id;
  const account = async (number: number, name: string, consolidation: number, consolidationName: string) => (await q(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, consolidation_account_number, consolidation_account_name)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [s.tenantId, chart, number, name, consolidation, consolidationName],
  ))[0].id as string;
  const accounts = { hosting: await account(7011, 'Hosting', 60, 'Software'), support: await account(7020, 'Support', 61, 'Services') };
  await q(`UPDATE spend_items SET account_id = $3 WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [s.tenantId, [s.lines.L1, s.lines.L2], accounts.hosting]);
  await q(`UPDATE spend_items SET account_id = $3 WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.lines.L3, accounts.support]);
  return { ...s, axis2Name, category2Name, axis1: first.axis_id, category1: first.category_id, accounts, costCenters };
}

/** The browser's subtree (`useCostCenterTree.descendantIds`): the node and every node below it. */
function browserSubtree(f: Fixture, id: string): string[] {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    if (out.has(current)) continue;
    out.add(current);
    for (const node of f.costCenters) if (node.parent_id === current) stack.push(node.id);
  }
  return [...out];
}

function ctxOf(m: EntityManager, f: Fixture, person: Person) {
  return { tenantId: f.tenantId, userId: person.id, userRoles: [], isAdmin: person.isAdmin, permissions: person.permissions ?? {}, manager: m };
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

type Report = 'comparison' | 'columns-compare' | 'top-lines' | 'increases-decreases' | 'consolidation' | 'analytics';
const HANDLER = {
  comparison: 'comparison',
  'columns-compare': 'columnsCompare',
  'top-lines': 'topLines',
  'increases-decreases': 'increasesDecreases',
  consolidation: 'consolidation',
  analytics: 'analytics',
} as const;

function requestOf(m: EntityManager, f: Fixture, person: Person, report: Report, query: Record<string, unknown>) {
  return { queryRunner: { manager: m, isReleased: false }, tenant: { id: f.tenantId }, user: { sub: person.id }, query, path: `/reports/budget/${report}/export` };
}

async function exportFile(c: BudgetReportExportController, m: EntityManager, f: Fixture, person: Person, report: Report, query: Record<string, unknown>) {
  const out = response(requestOf(m, f, person, report, query));
  await (c as any)[HANDLER[report]](query, ctxOf(m, f, person), out.res);
  return out;
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

const trim = (row: string[]): string[] => {
  const out = [...row];
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
};

/** A table as the file writes it: headers, then each row's cells by column kind, then the footer unless limited. */
function written(table: T.ReportTableData, limited = false): string[][] {
  const cell = (kind: T.ReportTableColumnKind, value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (kind === 'amount') return (Math.round((value as number) * 100) / 100).toFixed(2);
    return String(value);
  };
  const line = (row: T.ReportTableRow) => trim(table.columns.map((column) => cell(column.kind, row[column.key])));
  return [table.columns.map((column) => column.header), ...table.rows.map(line), ...(limited ? [] : table.footer.map(line))];
}

/** The data sheet of a one-table workbook (its name is the report title, cut and cleaned for Excel), then Parameters. */
function dataSheet(sheets: Map<string, string[][]>): string[][] {
  const names = [...sheets.keys()];
  assert.equal(names.length, 2, 'one table, then Parameters');
  assert.equal(names[1], 'Parameters');
  return sheets.get(names[0])!.map(trim);
}

/** Each amount column of the data rows adds up to the footer (the screen's total), to the cent. */
function assertColumnsAddUp(table: T.ReportTableData, what: string): void {
  assert.equal(table.footer.length, 1, `${what}: one total row`);
  for (const column of table.columns.filter((c) => c.kind === 'amount')) {
    const sum = table.rows.reduce((acc, row) => acc + Math.round(((row[column.key] as number | null) ?? 0) * 100), 0);
    assert.equal(sum, Math.round(((table.footer[0][column.key] as number | null) ?? 0) * 100), `${what}: column ${column.header} adds up to the total`);
  }
}

/** What the screen shows for a request: the aggregate route's answer (its service call), read by the frontend files. */
async function screenAnswer(svc: ReturnType<typeof services>, m: EntityManager, f: Fixture, person: Person, scope: R.BudgetScope, request: R.AggregateRequest) {
  const opts = { manager: m, access: budgetListAccess(ctxOf(m, f, person)) };
  const answer = scope === 'all'
    ? await svc.lines.summaryAggregateRequest(request, opts)
    : await (scope === 'capex' ? svc.capex : svc.opex).summaryAggregateRequest(request, opts);
  return answer as unknown as R.AggregateResult & { dataAccessLimited?: true };
}

async function testTables(runner: QueryRunner, f: Fixture): Promise<void> {
  const svc = services();
  const admin: Person = { id: f.persons.admin, isAdmin: true };
  await as(runner, admin.id, async (m) => {
    const inf = browserSubtree(f, f.inf);
    assert.equal(inf.length, 3, 'INF and its two centres');
    const filters = R.reportFilterModels({ costCenterIds: inf, runBuild: null, analytics: [[f.axis2, f.category2]], withFte: false });
    const address = { costCenter: f.inf, analytics: `${f.axis2}:${f.category2}` };

    // Comparison, every line type, cost center and dimension filters: L1 to L3.
    const years = [Y, Y + 1];
    const comparisonAnswer = await screenAnswer(svc, m, f, admin, 'all', R.trendRequest({ years, metrics: ['budget', 'revision'], windowYears: [Y - 2, Y - 1, Y, Y + 1, Y + 2], filters, measure: 'amount' }));
    const comparison = T.comparisonTable({ years, metrics: ['budget', 'revision'], measure: 'amount' }, comparisonAnswer, LABELS);
    const comparisonFile = await exportFile(svc.controller, m, f, admin, 'comparison', { ...address, startYear: String(Y), endYear: String(Y + 1), metrics: 'budget,revision', format: 'xlsx', language: 'en' });
    const comparisonSheets = workbook(comparisonFile.body());
    assert.deepEqual([...comparisonSheets.keys()], [L.comparisonSheet, 'Parameters']);
    assert.deepEqual(comparisonSheets.get(L.comparisonSheet)!.map(trim), written(comparison), 'comparison = the screen table');
    assert.equal(comparison.rows[0][String(Y)], (100.25 + 200.25 + 300.25), 'the filters keep L1 to L3');
    const parameters = comparisonSheets.get('Parameters')!.map(trim);
    assert.deepEqual(parameters.slice(1, 9), [
      ['Line type', 'All'],
      ['Measure', 'Amount'],
      ['Cost center', 'INF · INF'],
      [f.axis2Name, f.category2Name],
      ['Reporting currency', 'EUR'],
      ['Start year', String(Y)],
      ['End year', String(Y + 1)],
      ['Metrics', 'Budget, Revision'],
    ], 'the parameters in words');
    assert.match(comparisonFile.headers['Content-Disposition'], new RegExp(`filename="comparison-all-${Y}-${Y + 1}-\\d{4}-\\d{2}-\\d{2}\\.xlsx"`));

    // Columns compare, year-grouped (a pair picked twice adds up), then flat in FTE on INF-FR.
    const picked: T.ColumnSelection[] = [{ year: Y + 1, metric: 'budget' }, { year: Y, metric: 'budget' }, { year: Y, metric: 'budget' }];
    const sorted = T.sortColumnSelections(picked);
    const groupedAnswer = await screenAnswer(svc, m, f, admin, 'opex', R.columnsCompareRequest({ selections: sorted, filters, measure: 'amount' }));
    const grouped = T.columnsCompareTable({ selections: sorted, measure: 'amount', yearGrouping: true }, groupedAnswer, LABELS);
    assert.equal(grouped.grouped, true);
    const groupedFile = await exportFile(svc.controller, m, f, admin, 'columns-compare', {
      ...address, scope: 'opex', selections: picked.map((p) => `${p.year}:${p.metric}`).join(','), yearGrouping: 'true', format: 'xlsx', language: 'en',
    });
    const groupedSheets = workbook(groupedFile.body());
    assert.deepEqual(groupedSheets.get(L.columnsCompareSheet)!.map(trim), written(grouped), 'year-grouped = the screen table');
    assert.ok(groupedSheets.get('Parameters')!.some((row) => row[0] === 'Year grouping' && row[1] === 'Yes'));

    const infFr = browserSubtree(f, f.infFr);
    const fteFilters = R.reportFilterModels({ costCenterIds: infFr, runBuild: null, analytics: [], withFte: false });
    const flatPicked: T.ColumnSelection[] = [{ year: Y, metric: 'budget' }, { year: Y + 1, metric: 'budget' }];
    const fteAnswer = await screenAnswer(svc, m, f, admin, 'all', R.columnsCompareRequest({ selections: flatPicked, filters: fteFilters, measure: 'fte' }));
    const flat = T.columnsCompareTable({ selections: flatPicked, measure: 'fte', yearGrouping: false }, fteAnswer, LABELS);
    assert.equal(flat.rows[0].total, 0.5 + 1.5, 'the FTE declared on L1 and L3 (INF-FR)');
    assert.equal(flat.rows[1].total, null, 'nobody declares FTE in Y+1: blank');
    const flatFile = await exportFile(svc.controller, m, f, admin, 'columns-compare', {
      costCenter: f.infFr, measure: 'fte', selections: `${Y}:budget,${Y + 1}:budget`, format: 'xlsx', language: 'en',
    });
    assert.deepEqual(workbook(flatFile.body()).get(L.columnsCompareSheet)!.map(trim), written(flat), 'flat FTE = the screen table');
    assert.match(flatFile.headers['Content-Disposition'], /filename="budget-columns-compare-all-fte-/);

    // Top lines, OPEX, one line excluded, then the FTE top.
    const topAnswer = await screenAnswer(svc, m, f, admin, 'opex', R.topItemsRequest({
      scope: 'opex', year: Y, metric: 'budget', topCount: 3, excludedIds: [f.lines.L7], excludedAccounts: [], filters: {}, measure: 'amount',
    }));
    const top = T.topLinesTable({ year: Y, metric: 'budget', measure: 'amount' }, topAnswer, LABELS);
    assert.deepEqual(top.rows.map((row) => row.id), [f.lines.L6, f.lines.L5, f.lines.L4], 'largest first, L7 excluded');
    const topFile = await exportFile(svc.controller, m, f, admin, 'top-lines', {
      scope: 'opex', year: String(Y), metric: 'budget', top: '3', excludeIds: f.lines.L7, format: 'xlsx', language: 'en',
    });
    const topSheets = workbook(topFile.body());
    assert.deepEqual(topSheets.get(L.topLinesSheet)!.map(trim), written(top), 'top lines = the screen table, shares as fractions');
    const l7 = (await m.query(`SELECT item_number, product_name FROM spend_items WHERE tenant_id = $1 AND id = $2`, [f.tenantId, f.lines.L7]))[0];
    assert.ok(topSheets.get('Parameters')!.some((row) => row[0] === 'Exclude lines' && row[1] === `BL-${l7.item_number} ${l7.product_name}`), 'the excluded line by reference and name');

    const fteTopAnswer = await screenAnswer(svc, m, f, admin, 'all', R.topItemsRequest({
      scope: 'all', year: Y, metric: 'budget', topCount: 10, excludedIds: [], excludedAccounts: [], filters: {}, measure: 'fte',
    }));
    const fteTop = T.topLinesTable({ year: Y, metric: 'budget', measure: 'fte' }, fteTopAnswer, LABELS);
    assert.equal(fteTop.rows.length, 3, 'the lines declaring FTE only');
    const fteTopFile = await exportFile(svc.controller, m, f, admin, 'top-lines', { measure: 'fte', year: String(Y), metric: 'budget', top: '10', format: 'csv', language: 'en' });
    const csv = fteTopFile.body().toString('utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.equal(csv.length, 1 + fteTop.rows.length, 'CSV: header and the three lines');
    assert.equal(csv[0], 'Line,Budget FTE (' + Y + '),Share of total');
  });
  console.log('  comparison, columns compare (grouped, flat FTE) and top lines (amount, FTE) equal the screen tables: OK');
}

/** Increases and decreases, consolidation and analytics, each with a cost center and a dimension filter; increases and decreases in FTE too. */
async function testDeltaGroupTables(runner: QueryRunner, f: Fixture): Promise<void> {
  const svc = services();
  const admin: Person = { id: f.persons.admin, isAdmin: true };
  await as(runner, admin.id, async (m) => {
    const inf = browserSubtree(f, f.inf);
    const filters = R.reportFilterModels({ costCenterIds: inf, runBuild: null, analytics: [[f.axis2, f.category2]], withFte: false });
    const address = { costCenter: f.inf, analytics: `${f.axis2}:${f.category2}` };
    const source = { year: Y, metric: 'budget' as const };
    const destination = { year: Y + 1, metric: 'budget' as const };

    // Both directions: L1 and L2 rise, L3 falls; two requests, increases first.
    const modes: R.DeltaMode[] = ['increase', 'decrease'];
    const deltaAnswers = [];
    for (const request of R.deltaRequests({ scope: 'all', source, destination, modes, topCount: 10, excludedIds: [], excludedAccounts: [], filters, measure: 'amount' })) {
      deltaAnswers.push(await screenAnswer(svc, m, f, admin, 'all', request));
    }
    const delta = T.deltaTable({ source, destination, modes, measure: 'amount' }, deltaAnswers, LABELS);
    assert.deepEqual(delta.rows.map((row) => [row.id, row.direction]), [[f.lines.L1, 'increase'], [f.lines.L2, 'increase'], [f.lines.L3, 'decrease']]);
    assert.equal(delta.rows[0].pct_increase, (350.5 - 100.25) / 100.25, 'the change as a fraction of the source');
    const deltaFile = await exportFile(svc.controller, m, f, admin, 'increases-decreases', {
      ...address, sourceYear: String(Y), sourceMetric: 'budget', destinationYear: String(Y + 1), destinationMetric: 'budget', direction: 'both', top: '10', format: 'xlsx', language: 'en',
    });
    const deltaSheets = workbook(deltaFile.body());
    assert.deepEqual(dataSheet(deltaSheets), written(delta), 'increases and decreases = the screen table');
    const deltaParameters = deltaSheets.get('Parameters')!.map(trim);
    for (const pair of [['Source year', String(Y)], ['Source metric', 'Budget'], ['Destination year', String(Y + 1)], ['Destination metric', 'Budget'], ['Increase or decrease', 'Both'], ['Top count', '10']]) {
      assert.ok(deltaParameters.some((row) => row[0] === pair[0] && row[1] === pair[1]), `parameter ${pair.join(': ')}`);
    }
    assert.match(deltaFile.headers['Content-Disposition'], new RegExp(`filename="top2-1-all-delta-${Y}-budget-to-${Y + 1}-budget-decrease-increase-`));

    // FTE, OPEX, decreases: L2 left out by id, L1 by its account label; the FTE of Y+1 nobody declares.
    const fteAnswer = await screenAnswer(svc, m, f, admin, 'opex', R.deltaRequests({
      scope: 'opex', source, destination, modes: ['decrease'], topCount: 10, excludedIds: [f.lines.L2], excludedAccounts: ['7011 - Hosting'], filters: {}, measure: 'fte',
    })[0]);
    const fteDelta = T.deltaTable({ source, destination, modes: ['decrease'], measure: 'fte' }, [fteAnswer], LABELS);
    assert.deepEqual(fteDelta.rows.map((row) => [row.id, row.previous, row.current, row.delta]), [[f.lines.L3, 1.5, null, -1.5]]);
    const fteFile = await exportFile(svc.controller, m, f, admin, 'increases-decreases', {
      scope: 'opex', measure: 'fte', sourceYear: String(Y), sourceMetric: 'budget', destinationYear: String(Y + 1), destinationMetric: 'budget', direction: 'decrease', top: '10',
      excludeIds: f.lines.L2, excludeAccounts: '["7011 - Hosting"]', format: 'xlsx', language: 'en',
    });
    const fteSheets = workbook(fteFile.body());
    assert.deepEqual(dataSheet(fteSheets), written(fteDelta), 'FTE decreases = the screen table');
    assert.ok(fteSheets.get('Parameters')!.some((row) => row[0] === 'Exclude accounts' && row[1] === '7011 - Hosting'));

    // Consolidation: L1 and L2 on Software, L3 on Services; then Services and the unassigned lines left out.
    const years = [Y, Y + 1];
    const consolidationAnswer = await screenAnswer(svc, m, f, admin, 'all', R.consolidationRequest({ years, metric: 'budget', excludedAccountIds: [], filters, measure: 'amount' }));
    const consolidation = T.consolidationTable({ years, metric: 'budget', measure: 'amount' }, consolidationAnswer, LABELS);
    assert.deepEqual(consolidation.rows.map((row) => row.group), ['[60] Software', '[61] Services'], 'the first year\'s largest first');
    assertColumnsAddUp(consolidation, 'consolidation');
    const consolidationFile = await exportFile(svc.controller, m, f, admin, 'consolidation', {
      ...address, startYear: String(Y), endYear: String(Y + 1), metric: 'budget', format: 'xlsx', language: 'en',
    });
    assert.deepEqual(dataSheet(workbook(consolidationFile.body())), written(consolidation), 'consolidation = the screen table, the total last');
    const keptAnswer = await screenAnswer(svc, m, f, admin, 'all', R.consolidationRequest({ years, metric: 'budget', excludedAccountIds: [f.accounts.support, R.NO_CONSOLIDATION_LINE], filters: {}, measure: 'amount' }));
    const kept = T.consolidationTable({ years, metric: 'budget', measure: 'amount' }, keptAnswer, LABELS);
    assert.deepEqual(kept.rows.map((row) => row.group), ['[60] Software']);
    const keptFile = await exportFile(svc.controller, m, f, admin, 'consolidation', {
      startYear: String(Y), endYear: String(Y + 1), metric: 'budget', excludeAccounts: `${f.accounts.support},none`, format: 'xlsx', language: 'en',
    });
    const keptSheets = workbook(keptFile.body());
    assert.deepEqual(dataSheet(keptSheets), written(kept));
    assert.ok(keptSheets.get('Parameters')!.some((row) => row[0] === 'Exclude accounts' && row[1] === '[7020] Support, Unassigned'), 'the excluded accounts by label');

    // Analytics on the second dimension, filtered on the first: L1 to L3 hold its value, the other INF lines none.
    const analyticsFilters = R.reportFilterModels({ costCenterIds: inf, runBuild: null, analytics: [[f.axis1, f.category1]], withFte: false });
    const analyticsAnswer = await screenAnswer(svc, m, f, admin, 'all', R.analyticsRequest({ axisId: f.axis2, years, metric: 'budget', excludedIds: [], filters: analyticsFilters, measure: 'amount' }));
    const analytics = T.analyticsTable({ years, metric: 'budget', measure: 'amount', dimension: f.axis2Name }, analyticsAnswer, LABELS);
    assert.deepEqual(new Set(analytics.rows.map((row) => row.group)), new Set([f.category2Name, L.analyticsUnassigned]));
    assertColumnsAddUp(analytics, 'analytics');
    const analyticsFile = await exportFile(svc.controller, m, f, admin, 'analytics', {
      costCenter: f.inf, analytics: `${f.axis1}:${f.category1}`, axis: f.axis2, startYear: String(Y), endYear: String(Y + 1), metric: 'budget', format: 'xlsx', language: 'en',
    });
    const analyticsSheets = workbook(analyticsFile.body());
    assert.deepEqual(dataSheet(analyticsSheets), written(analytics), 'analytics = the screen table, headed by the dimension');
    assert.ok(analyticsSheets.get('Parameters')!.some((row) => row[0] === 'Dimension' && row[1] === f.axis2Name));
    const valuedAnswer = await screenAnswer(svc, m, f, admin, 'all', R.analyticsRequest({ axisId: f.axis2, years, metric: 'budget', excludedIds: [R.NO_ANALYTICS_VALUE], filters: analyticsFilters, measure: 'amount' }));
    const valued = T.analyticsTable({ years, metric: 'budget', measure: 'amount', dimension: f.axis2Name }, valuedAnswer, LABELS);
    const valuedFile = await exportFile(svc.controller, m, f, admin, 'analytics', {
      costCenter: f.inf, analytics: `${f.axis1}:${f.category1}`, axis: f.axis2, startYear: String(Y), endYear: String(Y + 1), metric: 'budget', excludeValues: 'none', format: 'csv', language: 'en',
    });
    const csv = valuedFile.body().toString('utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.equal(csv.length, 1 + valued.rows.length + 1, 'CSV: header, the valued group, the total');
    assert.equal(csv[0], `${f.axis2Name},${Y},${Y + 1}`);
  });

  // A person who cannot read the accounts page: every line unassigned, on the screen and in the file.
  const noAccounts: Person = { id: f.persons.admin, isAdmin: false };
  await as(runner, noAccounts.id, async (m) => {
    const years = [Y];
    const answer = await screenAnswer(svc, m, f, noAccounts, 'all', R.consolidationRequest({ years, metric: 'budget', excludedAccountIds: [], filters: {}, measure: 'amount' }));
    const expected = T.consolidationTable({ years, metric: 'budget', measure: 'amount' }, answer, LABELS);
    assert.deepEqual(expected.rows.map((row) => row.group), [L.consolidationUnassigned], 'no consolidation line without the accounts page');
    const file = await exportFile(svc.controller, m, f, noAccounts, 'consolidation', { startYear: String(Y), endYear: String(Y), metric: 'budget', format: 'xlsx', language: 'en' });
    assert.deepEqual(dataSheet(workbook(file.body())), written(expected), 'what the route gives them');
    const reader: Person = { ...noAccounts, permissions: { accounts: 'reader' } };
    const readerAnswer = await screenAnswer(svc, m, f, reader, 'all', R.consolidationRequest({ years, metric: 'budget', excludedAccountIds: [], filters: {}, measure: 'amount' }));
    const readerTable = T.consolidationTable({ years, metric: 'budget', measure: 'amount' }, readerAnswer, LABELS);
    assert.ok(readerTable.rows.some((row) => row.group === '[60] Software'), 'an accounts reader sees the consolidation lines');
    const readerFile = await exportFile(svc.controller, m, f, reader, 'consolidation', { startYear: String(Y), endYear: String(Y), metric: 'budget', format: 'xlsx', language: 'en' });
    assert.deepEqual(dataSheet(workbook(readerFile.body())), written(readerTable));
  });
  console.log('  increases and decreases (both, FTE), consolidation (exclusions, without the accounts page) and analytics equal the screen tables: OK');
}

async function testLimited(runner: QueryRunner, f: Fixture): Promise<void> {
  const svc = services();
  const marta: Person = { id: f.persons.marta, isAdmin: false };
  await as(runner, marta.id, async (m) => {
    const answer = await screenAnswer(svc, m, f, marta, 'all', R.topItemsRequest({
      scope: 'all', year: Y, metric: 'budget', topCount: 10, excludedIds: [], excludedAccounts: [], filters: {}, measure: 'amount',
    }));
    assert.equal(answer.dataAccessLimited, true);
    const expected = T.topLinesTable({ year: Y, metric: 'budget', measure: 'amount' }, answer, LABELS);
    assert.deepEqual(new Set(expected.rows.map((row) => row.id)), new Set([f.lines.L2, f.lines.L3, f.lines.L4, f.lines.L5]), 'her lines only');
    const file = await exportFile(svc.controller, m, f, marta, 'top-lines', { year: String(Y), metric: 'budget', top: '10', format: 'xlsx', language: 'en' });
    const sheets = workbook(file.body());
    assert.deepEqual(sheets.get(L.topLinesSheet)!.map(trim), written(expected), 'the screen table on her lines');
    assert.ok(sheets.get('Parameters')!.some((row) => row[0] === 'Computed on your access'), 'the access line');
    assert.equal(file.headers[DATA_ACCESS_HEADER], 'limited');
    await assert.rejects(
      () => exportFile(svc.controller, m, f, marta, 'top-lines', { year: String(Y), metric: 'budget', top: '10', excludeIds: f.lines.L1 }),
      (error: any) => error.getStatus?.() === 400 && /is not a line of this report/.test(error.message),
      'a line she cannot read cannot be excluded',
    );

    // Consolidation and increases and decreases on her lines: no total row.
    const years = [Y, Y + 1];
    const consolidation = T.consolidationTable({ years, metric: 'budget', measure: 'amount' }, await screenAnswer(svc, m, f, marta, 'all', R.consolidationRequest({
      years, metric: 'budget', excludedAccountIds: [], filters: {}, measure: 'amount',
    })), LABELS);
    const consolidationFile = await exportFile(svc.controller, m, f, marta, 'consolidation', { startYear: String(Y), endYear: String(Y + 1), metric: 'budget', format: 'xlsx', language: 'en' });
    const consolidationSheets = workbook(consolidationFile.body());
    assert.deepEqual(dataSheet(consolidationSheets), written(consolidation, true), 'consolidation on her lines, no total');
    assert.ok(consolidationSheets.get('Parameters')!.some((row) => row[0] === 'Computed on your access'));
    const source = { year: Y, metric: 'budget' as const };
    const destination = { year: Y + 1, metric: 'budget' as const };
    const answers = [];
    for (const request of R.deltaRequests({ scope: 'all', source, destination, modes: ['increase', 'decrease'], topCount: 10, excludedIds: [], excludedAccounts: [], filters: {}, measure: 'amount' })) {
      answers.push(await screenAnswer(svc, m, f, marta, 'all', request));
    }
    const delta = T.deltaTable({ source, destination, modes: ['increase', 'decrease'], measure: 'amount' }, answers, LABELS);
    assert.deepEqual(new Set(delta.rows.map((row) => row.id)), new Set([f.lines.L2, f.lines.L3, f.lines.L4, f.lines.L5]), 'her lines only');
    const deltaFile = await exportFile(svc.controller, m, f, marta, 'increases-decreases', {
      sourceYear: String(Y), sourceMetric: 'budget', destinationYear: String(Y + 1), destinationMetric: 'budget', direction: 'both', top: '10', format: 'xlsx', language: 'en',
    });
    assert.deepEqual(dataSheet(workbook(deltaFile.body())), written(delta));
    assert.equal(deltaFile.headers[DATA_ACCESS_HEADER], 'limited');
  });
  console.log('  limited: her lines only, the access line and header: OK');
}

async function testRefused(runner: QueryRunner, f: Fixture): Promise<void> {
  const svc = services();
  const admin: Person = { id: f.persons.admin, isAdmin: true };
  const missing = '00000000-0000-4000-8000-000000000000';
  const top = { year: String(Y), metric: 'budget', top: '10' };
  const comparison = { startYear: String(Y), endYear: String(Y + 1), metrics: 'budget' };
  const delta = { sourceYear: String(Y), sourceMetric: 'budget', destinationYear: String(Y + 1), destinationMetric: 'budget', direction: 'increase', top: '10' };
  const range = { startYear: String(Y), endYear: String(Y + 1), metric: 'budget' };
  const cases: Array<[Report, Record<string, unknown>, RegExp]> = [
    ['comparison', { ...comparison, sort: 'name' }, /Unknown parameter: sort/],
    ['comparison', { endYear: String(Y), metrics: 'budget' }, /startYear is required/],
    ['comparison', { ...comparison, startYear: String(Y - 3) }, /startYear must be between/],
    ['comparison', { ...comparison, startYear: String(Y + 1), endYear: String(Y) }, /startYear must not be after endYear/],
    ['comparison', { ...comparison, metrics: 'budget,budget' }, /names a column twice/],
    ['comparison', { ...comparison, metrics: 'forecast' }, /the column forecast is hidden/],
    ['comparison', { ...comparison, metrics: 'actuals' }, /unknown column actuals/],
    ['comparison', { ...comparison, scope: 'opex,capex' }, /scope must be all, opex or capex/],
    ['comparison', { ...comparison, measure: 'days' }, /measure must be amount or fte/],
    ['comparison', { ...comparison, costCenter: missing }, /no such cost center/],
    ['comparison', { ...comparison, runBuild: 'both' }, /runBuild must be run, build or none/],
    ['comparison', { ...comparison, fte: 'without' }, /fte must be with/],
    ['comparison', { ...comparison, analytics: f.axis2 }, /analytics must read/],
    ['comparison', { ...comparison, analytics: `${missing}:none` }, /is not an enabled dimension/],
    ['comparison', { ...comparison, analytics: `${f.axis2}:${missing}` }, /is not a value of the dimension/],
    ['comparison', { ...comparison, analytics: `${f.axis2}:none,${f.axis2}:none` }, /names a dimension twice/],
    ['columns-compare', { selections: `${Y}-budget` }, /selections must read/],
    ['columns-compare', { selections: Array.from({ length: 11 }, () => `${Y}:budget`).join(',') }, /10 pairs at most/],
    ['columns-compare', { selections: `${Y}:budget`, yearGrouping: 'yes' }, /yearGrouping must be true or false/],
    ['top-lines', { ...top, year: String(Y + 2) }, /year must be between/],
    ['top-lines', { ...top, top: '0' }, /top must be a whole number/],
    ['top-lines', { ...top, excludeIds: 'L1' }, /excludeIds must be line ids/],
    ['top-lines', { ...top, excludeIds: missing }, /is not a line of this report/],
    ['top-lines', { ...top, excludeAccounts: 'Licences' }, /excludeAccounts must be a JSON list/],
    ['top-lines', { ...top, excludeAccounts: '["6011 Licences"]' }, /no line holds the account 6011 Licences/],
    ['top-lines', { ...top, format: 'pdf' }, /format must be csv or xlsx/],
    ['increases-decreases', { ...delta, sourceYear: undefined }, /sourceYear is required/],
    ['increases-decreases', { ...delta, sourceYear: String(Y - 3) }, /sourceYear must be between/],
    ['increases-decreases', { ...delta, destinationYear: String(Y + 3) }, /destinationYear must be between/],
    ['increases-decreases', { ...delta, sourceMetric: 'actuals' }, /sourceMetric: unknown column actuals/],
    ['increases-decreases', { ...delta, destinationMetric: 'forecast' }, /destinationMetric: the column forecast is hidden/],
    ['increases-decreases', { ...delta, direction: 'up' }, /direction must be increase, decrease or both/],
    ['increases-decreases', { ...delta, direction: undefined }, /direction is required/],
    ['increases-decreases', { ...delta, top: 'ten' }, /top must be a whole number/],
    ['increases-decreases', { ...delta, excludeIds: missing }, /is not a line of this report/],
    ['increases-decreases', { ...delta, excludeAccounts: '["6011 Licences"]' }, /no line holds the account 6011 Licences/],
    ['increases-decreases', { ...delta, year: String(Y) }, /Unknown parameter: year/],
    ['consolidation', { ...range, startYear: String(Y - 2) }, /startYear must be between/],
    ['consolidation', { ...range, endYear: String(Y + 2) }, /endYear must be between/],
    ['consolidation', { ...range, metric: undefined }, /metric is required/],
    ['consolidation', { ...range, excludeAccounts: '7011' }, /excludeAccounts must be account ids or none/],
    ['consolidation', { ...range, excludeAccounts: missing }, /is not an account of this report/],
    ['consolidation', { ...range, excludeAccounts: 'none,none' }, /names a value twice/],
    ['consolidation', { ...range, excludeAccounts: '["7011 - Hosting"]' }, /excludeAccounts must be account ids or none/],
    ['analytics', { ...range, axis: 'default' }, /axis must be a dimension id/],
    ['analytics', { ...range, axis: missing }, /is not an enabled dimension of these lines/],
    ['analytics', { ...range, axis: f.axis2, excludeValues: 'Cloud' }, /excludeValues must be value ids or none/],
    ['analytics', { ...range, axis: f.axis1, excludeValues: f.category2 }, /is not a value of this dimension/],
    ['analytics', { ...range, axis: f.axis2, excludeAccounts: 'none' }, /Unknown parameter: excludeAccounts/],
  ];
  await as(runner, admin.id, async (m) => {
    for (const [report, query, message] of cases) {
      await assert.rejects(
        () => exportFile(svc.controller, m, f, admin, report, query),
        (error: any) => error.getStatus?.() === 400 && message.test(error.message),
        `${report} ${JSON.stringify(query)}`,
      );
    }
  });
  console.log(`  refused: ${cases.length} invalid requests, each a 400: OK`);
}

/** The audit row the export interceptor writes, completed with the format and the data row count. */
async function testAudit(runner: QueryRunner, f: Fixture): Promise<void> {
  const svc = services();
  const admin: Person = { id: f.persons.admin, isAdmin: true };
  // The consolidation's total row is not counted: Software, Services and the unassigned lines.
  const cases: Array<[Report, Record<string, unknown>, number]> = [
    ['top-lines', { scope: 'opex', year: String(Y), metric: 'budget', top: '4', format: 'xlsx', language: 'en' }, 4],
    ['consolidation', { startYear: String(Y), endYear: String(Y), metric: 'budget', format: 'xlsx', language: 'en' }, 3],
    ['increases-decreases', {
      sourceYear: String(Y), sourceMetric: 'budget', destinationYear: String(Y + 1), destinationMetric: 'budget', direction: 'both', top: '2', format: 'csv', language: 'en',
    }, 4],
  ];
  await as(runner, admin.id, async (m) => {
    for (const [report, query, count] of cases) {
      const req = requestOf(m, f, admin, report, query);
      const out = response(req);
      const handler = (BudgetReportExportController.prototype as any)[HANDLER[report]];
      const context: any = {
        getType: () => 'http',
        getClass: () => BudgetReportExportController,
        getHandler: () => handler,
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => out.res }),
      };
      const call = () => from((svc.controller as any)[HANDLER[report]](query, ctxOf(m, f, admin), out.res) as Promise<void>);
      await lastValueFrom(new ExportEventsInterceptor().intercept(context, { handle: call }), { defaultValue: undefined });
      const rows: Array<{ after: any }> = await m.query(
        `SELECT after_json AS after FROM audit_log WHERE tenant_id = $1 AND table_name = 'export' AND after_json->>'path' = $2`,
        [f.tenantId, `/reports/budget/${report}/export`],
      );
      assert.equal(rows.length, 1, `${report}: one export row`);
      assert.deepEqual(
        { resource: rows[0].after.resource, format: rows[0].after.format, rows: rows[0].after.rows },
        { resource: `reports/budget/${report}`, format: query.format, rows: count },
        report,
      );
    }
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
      console.log(`budget report export: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('budget report exports against the screen tables');
    await runner.startTransaction();
    try {
      const f = await enrich(runner, await seed(clientOf(runner)));
      await testTables(runner, f);
      await testDeltaGroupTables(runner, f);
      await testLimited(runner, f);
      await testRefused(runner, f);
      await testAudit(runner, f);
    } finally {
      await runner.rollbackTransaction();
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
  console.log('budget-report-export.integration.spec: OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
