import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import AdmZip = require('adm-zip');
import { columnNumberToName } from '../../../common/xlsx/write';
import { parseExportFormat, XLSX_CONTENT_TYPE } from '../../../common/xlsx';
import { writeCsv } from '../../../common/csv-sheet';
import { budgetCsvRows, buildBudgetExport, exportListQuery, writeBudgetFile } from '../export-file';
import { emptyMonths, StoredLine } from '../types';

// The budget file in xlsx, without a database: the cells of `buildBudgetExport` written by the common
// writer and read back from the sheet's XML (Excel export, lot 1, run B).

function line(patch: Partial<StoredLine> = {}): StoredLine {
  return {
    id: 'line-1', nature: 'opex', itemNumber: 12, legacyNumber: null, rowVersion: 7, name: 'Licences', description: null,
    companyId: 'c1', companyName: 'Acme', supplierId: null, supplierName: null, supplierErpId: null, accountId: null,
    accountNumber: '01100', costCenterId: null, costCenterCode: null, costCenterPath: null, runBuild: null, analytics: {},
    ownerItEmail: null, ownerBusinessEmail: null, projectNumber: null, currency: 'EUR', effectiveStart: '2026-03-15',
    endOfValidity: '2027-06-30T22:30:00.000Z', notes: null, versions: [], ...patch,
  };
}

function withMonths(cents: Array<bigint | null>) {
  const months = emptyMonths();
  cents.forEach((value, index) => {
    months.planned[index] = { cents: value };
  });
  return [{ id: 'v-2026', year: 2026, budgetRev: 4, months }];
}

const LINES = [
  line({ versions: withMonths([-5n, 0n, 123456789n]) }),
  line({ id: 'line-2', itemNumber: 13, name: 'Nothing yet', accountNumber: null, effectiveStart: '', endOfValidity: null }),
];

const built = (detail: 'months' | 'yearly') =>
  buildBudgetExport({ language: 'fr', years: [2026], columns: ['budget'], detail, lines: LINES, dimensions: [] });

function cells(xml: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*>.*?<\/c>/gs)) found.set(match[1], match[0]);
  return found;
}

function testWorkbook() {
  const months = built('months');
  const file = writeBudgetFile(months, 'fr', 'xlsx');
  assert.equal(file.filename, 'budget.xlsx');
  assert.equal(file.contentType, XLSX_CONTENT_TYPE);
  assert.ok(Buffer.isBuffer(file.content));
  const zip = new AdmZip(file.content as Buffer);
  assert.match(zip.readAsText('xl/workbook.xml'), /<sheet name="budget" sheetId="1"/, 'one sheet named budget');
  const styles = zip.readAsText('xl/styles.xml');
  const xfs = [...(styles.match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/s)?.[1] ?? '').matchAll(/<xf [^>]*\/>/g)].map((m) => m[0]);
  assert.match(xfs[3], /numFmtId="4"/, 'style 3 is #,##0.00');
  assert.match(xfs[1], /numFmtId="164"/, 'style 1 is the date');
  assert.match(styles, /<numFmt numFmtId="164" formatCode="\[\$-40C\]dd\/mm\/yyyy"\/>/, 'French days');

  const xml = zip.readAsText('xl/worksheets/sheet1.xml');
  const all = cells(xml);
  const at = (header: string, row: number) => `${columnNumberToName(months.headers.indexOf(header) + 1)}${row}`;
  const cell = (header: string, row: number) => all.get(at(header, row));
  assert.equal(cell('budget_2026_01', 2), `<c r="${at('budget_2026_01', 2)}" s="3"><v>-0.05</v></c>`, 'negative cents, exact');
  assert.equal(cell('budget_2026_02', 2), `<c r="${at('budget_2026_02', 2)}" s="3"><v>0.00</v></c>`, 'a stored zero is 0.00');
  assert.equal(cell('budget_2026_03', 2), `<c r="${at('budget_2026_03', 2)}" s="3"><v>1234567.89</v></c>`, 'a large amount, exact');
  assert.equal(cell('budget_2026_04', 2), undefined, 'a month with no amount writes no cell');
  assert.equal(cell('budget_2026_01', 3), undefined, 'a line with no amounts writes no amount cell');
  assert.equal(cell('effective_start', 2), `<c r="${at('effective_start', 2)}" s="1"><v>46096</v></c>`, 'the start day as a serial');
  assert.equal(cell('end_of_validity', 2), `<c r="${at('end_of_validity', 2)}" s="1"><v>46568</v></c>`, 'the end of validity: the stored instant\'s UTC day');
  assert.equal(cell('effective_start', 3), undefined);
  assert.equal(cell('end_of_validity', 3), undefined);
  const textCell = (header: string, row: number, value: string) =>
    assert.equal(cell(header, row), `<c r="${at(header, row)}" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`, `${header} is text`);
  textCell('account_number', 2, '01100');
  textCell('item_number', 2, 'BL-12');
  textCell('kanap_token', 2, 'v7.2026r4.fr');
  textCell('kanap_token', 3, 'v7.fr');
  textCell('currency', 2, 'EUR');
  assert.equal(cell('account_number', 3), undefined, 'no account: no cell');

  // Yearly: the sum of the months, with its cents.
  const yearly = writeBudgetFile(built('yearly'), 'fr', 'xlsx');
  const yearlyXml = new AdmZip(yearly.content as Buffer).readAsText('xl/worksheets/sheet1.xml');
  const yearlyHeaders = built('yearly').headers;
  const ref = `${columnNumberToName(yearlyHeaders.indexOf('budget_2026') + 1)}2`;
  assert.equal(cells(yearlyXml).get(ref), `<c r="${ref}" s="3"><v>1234567.84</v></c>`);
  console.log('  workbook: amounts exact and numeric, days as days, codes as text, empty amounts absent: OK');
}

function testCsvBranch() {
  const months = built('months');
  const file = writeBudgetFile(months, 'fr', 'csv');
  assert.equal(file.filename, 'budget.csv');
  assert.equal(file.contentType, 'text/csv; charset=utf-8');
  assert.equal(file.content, writeCsv({ language: 'fr', headers: months.headers, rows: budgetCsvRows(months.rows, 'fr') }));
  const row = (file.content as string).split('\n')[1].split(';');
  assert.deepEqual(row.slice(months.headers.indexOf('budget_2026_01'), months.headers.indexOf('budget_2026_01') + 4), ['-0,05', '0,00', '1234567,89', '']);
  console.log('  csv: the same cells, the language\'s way: OK');
}

function testFormat() {
  assert.equal(parseExportFormat(undefined), 'csv');
  assert.equal(parseExportFormat(''), 'csv');
  assert.equal(parseExportFormat('csv'), 'csv');
  assert.equal(parseExportFormat('xlsx'), 'xlsx');
  for (const raw of ['pdf', 'XLSX', ['xlsx', 'csv'], 'xls']) {
    assert.throws(() => parseExportFormat(raw), (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal((error.getResponse() as { message: string }).message, 'format must be csv or xlsx.');
      return true;
    }, String(raw));
  }
  assert.equal(exportListQuery({ format: 'xlsx', sort: 'name:ASC' }, false).format, undefined, 'format is not a list parameter');
  console.log('  format: csv by default, xlsx, anything else 400: OK');
}

function run() {
  console.log('budget file xlsx');
  testWorkbook();
  testCsvBranch();
  testFormat();
  console.log('budget-file-xlsx.spec: all assertions passed');
}

run();
