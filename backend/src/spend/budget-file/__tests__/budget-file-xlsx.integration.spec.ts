import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import AdmZip = require('adm-zip');
import { ConflictException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { writeXlsx } from '../../../common/xlsx';
import { XLSX_OLD_FORMAT_MESSAGE } from '../../../common/xlsx/read';
import { CSV_DECODE_MESSAGES } from '../../../common/csv-sheet/decode';
import { withImportXlsx } from '../../../common/__tests__/import-xlsx-flag';
import { PREFLIGHT_STALE } from '../import-file';
import { BudgetFileReport, BudgetFileExportScope } from '../types';
import { budgetFileService, lineServices, reportProblems } from '../../__tests__/budget-file.fixtures';
import { captureAudit, Kind, noFreeze, seedItem, seedTenant, seedVersion, setTenant } from '../../__tests__/round-inputs.fixtures';

/**
 * The budget file in .xlsx through the real export, preflight and load, in one rolled-back
 * transaction (Excel export, lot 4, run B): for OPEX, CAPEX and all lines, the exported workbook
 * checks with nothing to change, one amount cell changed in the sheet loads exactly, the stale
 * snapshot is still refused, and the workbook saved again by LibreOffice checks with nothing to
 * change. A workbook of several sheets is read on its first; an .xls and a broken archive are file
 * errors of the report.
 */

const OPTIONS = { language: 'fr', dateOrder: '', createSuppliers: false, canCreateSuppliers: false };
const YEAR = 2026;
const SHEET = 'xl/worksheets/sheet1.xml';

type Caller = { manager: QueryRunner['manager']; tenantId: string; userId: null };

/** The sheet row of a line: the row whose cells name its reference. */
function rowOf(xml: string, ref: string): number {
  for (const match of xml.matchAll(/<row r="(\d+)"[^>]*>(.*?)<\/row>/gs)) {
    if (match[2].includes(`>${ref}</t>`)) return Number(match[1]);
  }
  throw new Error(`no row names ${ref}`);
}

/** The workbook with the number cell of `header` on the row of `ref` set to `value`, rewritten in the sheet's XML. */
function withAmount(workbook: Buffer, header: string, ref: string, value: string): Buffer {
  const zip = new AdmZip(workbook);
  const xml = zip.readAsText(SHEET);
  const column = new RegExp(`<c r="([A-Z]+)1"[^>]*><is><t[^>]*>${header}</t></is></c>`).exec(xml)?.[1];
  assert.ok(column, `the sheet has a ${header} column`);
  const cellRef = `${column}${rowOf(xml, ref)}`;
  const cell = new RegExp(`<c r="${cellRef}"([^>]*)><v>[^<]*</v></c>`);
  assert.match(xml, cell, `${cellRef} is a number cell`);
  zip.updateFile(SHEET, Buffer.from(xml.replace(cell, `<c r="${cellRef}"$1><v>${value}</v></c>`), 'utf8'));
  return zip.toBuffer();
}

function assertNothingToChange(report: BudgetFileReport, lines: number, label: string) {
  assert.equal(report.ok, true, `${label}: ${reportProblems(report)}`);
  assert.deepEqual(
    [report.changes.created, report.changes.updated, report.changes.unchanged, report.errorCount, report.changedSinceExportCount],
    [0, 0, lines, 0, 0],
    `${label}: nothing to change`,
  );
  assert.deepEqual(report.warnings.ignoredColumns, [], `${label}: no ignored column`);
  assert.equal(report.firstSheetOnly, undefined, `${label}: one sheet`);
}

async function plannedTotal(runner: QueryRunner, versionId: string): Promise<string> {
  const [row] = await runner.query(`SELECT COALESCE(sum(planned), 0)::text AS total FROM spend_amounts WHERE version_id = $1`, [versionId]);
  // Decimal text without trailing zeros: `12345.67`, `0.01`, `98765432.1`.
  return String(row.total).includes('.') ? String(row.total).replace(/\.?0+$/, '') : String(row.total);
}

/** A line of `kind` with 100 planned in January of YEAR; its reference and version. */
async function seedLineWithBudget(runner: QueryRunner, kind: Kind, tenantId: string, n: number, name: string) {
  const id = await seedItem(runner, kind, tenantId, n, name);
  const versionId = await seedVersion(runner, kind, tenantId, id, YEAR);
  await runner.query(`INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, '${YEAR}-01-01', 100)`, [tenantId, versionId]);
  const [row] = await runner.query(`SELECT item_number FROM spend_items WHERE id = $1`, [id]);
  return { id, versionId, ref: `BL-${row.item_number}` };
}

/** The LibreOffice copy of a workbook (`soffice --convert-to xlsx`), or null when soffice is not installed. */
function throughLibreOffice(workbook: Buffer, label: string): Buffer | null {
  if (spawnSync('which', ['soffice'], { encoding: 'utf8' }).status !== 0) {
    console.log(`  ${label}: LibreOffice round trip skipped (soffice not installed)`);
    return null;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-xlsx-'));
  try {
    const input = path.join(dir, 'in', 'budget.xlsx');
    fs.mkdirSync(path.dirname(input));
    fs.writeFileSync(input, workbook);
    const out = path.join(dir, 'out');
    const run = spawnSync(
      'soffice',
      [`-env:UserInstallation=file://${path.join(dir, 'profile')}`, '--headless', '--convert-to', 'xlsx', '--outdir', out, input],
      { encoding: 'utf8', timeout: 120_000 },
    );
    assert.equal(run.status, 0, `soffice: ${run.stderr}`);
    return fs.readFileSync(path.join(out, 'budget.xlsx'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * One round trip: export `scope` in xlsx, check it, change the budget of `target` in the sheet, load,
 * read the stored total; the first check's snapshot is then stale.
 */
async function roundTrip(
  runner: QueryRunner,
  caller: Caller,
  scope: BudgetFileExportScope,
  ids: string[],
  target: { kind: Kind; versionId: string; ref: string },
  value: string,
) {
  const route: Kind = scope === 'all' ? 'opex' : scope;
  const service = budgetFileService();
  const exported = await service.exportFile(scope, ids, caller, {
    language: 'fr', amountYears: String(YEAR), columns: 'budget', detail: 'yearly', format: 'xlsx',
  });
  assert.equal(exported.filename, 'budget.xlsx', scope);
  const workbook = exported.content as Buffer;
  const unchanged = await service.preflight(route, workbook, caller, OPTIONS);
  assertNothingToChange(unchanged, ids.length, `${scope}: the export`);

  const resaved = throughLibreOffice(workbook, scope);
  if (resaved) assertNothingToChange(await service.preflight(route, resaved, caller, OPTIONS), ids.length, `${scope}: the LibreOffice copy`);

  const changed = withAmount(workbook, `budget_${YEAR}`, target.ref, value);
  const report = await service.preflight(route, changed, caller, OPTIONS);
  assert.equal(report.ok, true, `${scope}: ${reportProblems(report)}`);
  assert.deepEqual([report.changes.updated, report.changes.unchanged], [1, ids.length - 1], `${scope}: one line to update`);
  const audit = captureAudit() as any;
  const deps = { items: lineServices(target.kind, audit), audit, freeze: noFreeze };
  const loaded = await service.importFile(route, changed, report.snapshot, caller, OPTIONS, deps);
  assert.deepEqual([loaded.ok, 'updated' in loaded && loaded.updated], [true, 1], `${scope}: ${JSON.stringify(loaded).slice(0, 400)}`);
  assert.equal(await plannedTotal(runner, target.versionId), value, `${scope}: the stored budget is the cell, exactly`);

  // The same file with the first check's snapshot: the line changed in between.
  await assert.rejects(
    () => service.importFile(route, changed, unchanged.snapshot, caller, OPTIONS, deps),
    (err: unknown) => err instanceof ConflictException && String(err.message).includes(PREFLIGHT_STALE),
    `${scope}: a stale snapshot is refused`,
  );
  assert.equal(await plannedTotal(runner, target.versionId), value, `${scope}: nothing written by the refused load`);
  console.log(`  ${scope}: export, check unchanged, one cell changed, load exact (${value}), stale snapshot refused: OK`);
}

async function testSheetsAndBrokenFiles(caller: Caller, ref: string) {
  const service = budgetFileService();
  const twoSheets = writeXlsx({
    language: 'fr',
    sheets: [
      { name: 'Lignes', headers: ['item_number', 'notes'], rows: [[ref, null]] },
      { name: 'Notes', headers: ['item_number', 'notes'], rows: [[ref, 'Not read']] },
    ],
  });
  const read = await service.preflight('opex', twoSheets, caller, OPTIONS);
  assert.equal(read.ok, true, reportProblems(read));
  assert.equal(read.changes.unchanged, 1, 'the second sheet is not read');
  assert.equal(read.firstSheetOnly, 'Lignes', 'the report names the sheet read');

  const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
  const truncated = twoSheets.subarray(0, Math.floor(twoSheets.length / 2));
  const notZip = Buffer.concat([Buffer.from('PK\u0003\u0004', 'latin1'), Buffer.alloc(200, 0x41)]);
  for (const [label, file, expected] of [
    ['an .xls', xls, XLSX_OLD_FORMAT_MESSAGE],
    ['a cut archive', truncated, null],
    ['a broken archive', notZip, null],
  ] as const) {
    const report = await service.preflight('opex', file, caller, OPTIONS);
    assert.equal(report.ok, false, label);
    assert.equal(report.fileErrors.length, 1, `${label}: ${reportProblems(report)}`);
    if (expected) assert.equal(report.fileErrors[0], expected, label);
    else assert.match(report.fileErrors[0], /^This (file is not an Excel workbook|Excel file could not be read)/, label);
    assert.deepEqual(report.snapshot.lines, [], `${label}: nothing to load`);
  }
  // With the imports in CSV only (IMPORT_XLSX off), the CSV decoder's sentences as before: "save as
  // CSV" for a workbook; this bare OLE header names no Workbook stream, so it is "not a CSV file".
  for (const [label, file, expected] of [
    ['a workbook', twoSheets, CSV_DECODE_MESSAGES.CSV_FILE_EXCEL],
    ['an OLE file', xls, CSV_DECODE_MESSAGES.CSV_FILE_NOT_TEXT],
  ] as const) {
    const report = await withImportXlsx(false, () => service.preflight('opex', file, caller, OPTIONS));
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.fileErrors, [expected], `${label}, IMPORT_XLSX off`);
    assert.equal(report.firstSheetOnly, undefined, `${label}, IMPORT_XLSX off`);
  }
  console.log('  first sheet only, said in the report; .xls and broken archives are file errors; CSV only when off: OK');
}

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    console.log('budget file in xlsx (Excel export, lot 4)');
    const tenantId = await seedTenant(runner, 'xlsx-l4');
    await setTenant(runner, tenantId);
    const caller: Caller = { manager: runner.manager, tenantId, userId: null };
    const opexA = await seedLineWithBudget(runner, 'opex', tenantId, 1, 'Licences');
    const opexB = await seedLineWithBudget(runner, 'opex', tenantId, 2, 'Support');
    const capexA = await seedLineWithBudget(runner, 'capex', tenantId, 1, 'Serveurs');
    const capexB = await seedLineWithBudget(runner, 'capex', tenantId, 2, 'Stockage');

    await roundTrip(runner, caller, 'opex', [opexA.id, opexB.id], { kind: 'opex', ...opexA }, '12345.67');
    await roundTrip(runner, caller, 'capex', [capexA.id, capexB.id], { kind: 'capex', ...capexB }, '0.01');
    await roundTrip(runner, caller, 'all', [opexA.id, opexB.id, capexA.id, capexB.id], { kind: 'capex', ...capexA }, '98765432.1');
    await testSheetsAndBrokenFiles(caller, opexB.ref);
    console.log('budget-file-xlsx.integration.spec: ok');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
