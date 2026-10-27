import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../__tests__/backend-root';
import { writeXlsx, XlsxCell } from '../../xlsx/write';
import { XLSX_OLD_FORMAT_MESSAGE } from '../../xlsx/read';
import { handmadeXlsx, si } from '../../xlsx/__tests__/fixtures/handmade';
import { CSV_FILE_EMPTY_MESSAGE, readCsv, readSheet, sheetCellText } from '../read';
import { BUDGET_AMOUNT_COLUMNS, CSV_ROW_CAP, CsvLanguage, CsvParsedAmount, CsvReadSchema } from '../types';

/**
 * readSheet: CSV and .xlsx through the same header matching, settlement and row building. Typed number
 * and date cells skip the settlement; text cells read as in a CSV file.
 */

const fixture = (name: string): Buffer => fs.readFileSync(backendPath('src', 'common', 'xlsx', '__tests__', 'fixtures', name));

function schema(language: CsvLanguage, fields: readonly string[], dateFields: readonly string[] = []): CsvReadSchema {
  return { fields, amounts: BUDGET_AMOUNT_COLUMNS, dateFields, language };
}

const BUDGET_FIELDS = ['kanap_token', 'account', 'description', 'effective_start', 'end_of_validity', 'count'];
const BUDGET_DATES = ['effective_start', 'end_of_validity'];

function amountText(parsed: CsvParsedAmount | undefined): string {
  if (!parsed) return 'missing';
  return parsed.kind === 'value' ? parsed.decimal.toString() : parsed.kind;
}

/** A one-sheet workbook written by the common writer. */
function workbook(headers: string[], rows: XlsxCell[][], language: CsvLanguage = 'fr'): Buffer {
  return writeXlsx({ language, sheets: [{ name: 'OPEX', headers, rows }] });
}

async function dispatch() {
  const csv = Buffer.from('account;budget_2027\n01100;12,5\n');
  const viaSheet = await readSheet(csv, schema('fr', ['account']));
  const { format, ...rest } = viaSheet;
  assert.equal(format, 'csv');
  assert.deepEqual(rest, await readCsv(csv, schema('fr', ['account'])), 'a CSV file reads exactly as readCsv reads it');
  assert.equal(viaSheet.sheetName, undefined);

  const xlsx = await readSheet(fixture('writer-budget.xlsx'), schema('fr', BUDGET_FIELDS, BUDGET_DATES));
  assert.equal(xlsx.format, 'xlsx');
  assert.equal(xlsx.sheetName, 'OPEX');
  assert.equal(xlsx.sheetCount, 2, 'the Parameters sheet is counted, not read');
  assert.equal(xlsx.separator, null);
}

async function writerFileReadsAsItsCsv() {
  const schemaFr = schema('fr', BUDGET_FIELDS, BUDGET_DATES);
  const xlsx = await readSheet(fixture('writer-budget.xlsx'), schemaFr);
  assert.deepEqual(xlsx.fileErrors, []);
  assert.deepEqual(xlsx.headerErrors, []);
  assert.equal(xlsx.headerLine, 1);
  assert.deepEqual(xlsx.rows.map((row) => row.line), [2, 3, 4], 'spreadsheet rows are the lines');
  const [first, second, third] = xlsx.rows;
  assert.equal(first.cells.kanap_token, 'k1.fr.0123456789abcdef');
  assert.equal(first.cells.account, '01100', 'an account stored as text keeps its zero');
  assert.deepEqual(first.dates.end_of_validity, { kind: 'date', isoDate: '2027-12-31', time: null }, 'end of validity stays its day');
  assert.equal(amountText(first.amounts.budget_2027), '12280');
  assert.equal(amountText(first.amounts.revision_2027), '-1234.56');
  assert.equal(second.cells.description, '=SUM(A1:A2)', 'the formula guard is undone as for CSV');
  assert.equal(amountText(second.amounts.revision_2027), 'blank');
  assert.equal(second.cells.count, '2.5');
  assert.equal(third.cells.description, 'spaced', 'cells are trimmed as for CSV');
  assert.equal(xlsx.dates, null, 'no text date: nothing to settle');
  assert.equal(xlsx.amounts, null, 'no text amount: nothing to settle');

  // The same lines as a French CSV export: the same cells, amounts and dates.
  const csv = await readCsv(
    Buffer.from(
      'kanap_token;account;description;effective_start;end_of_validity;budget_2027;revision_2027;count\n' +
        'k1.fr.0123456789abcdef;01100;Licences;01/01/2027;31/12/2027;12280,00;-1234,56;3\n' +
        "k1.fr.fedcba9876543210;0042;'=SUM(A1:A2);29/02/2028;;0,10;;2,5\n" +
        ';;  spaced  ;;;;;\n',
    ),
    schemaFr,
  );
  assert.deepEqual(csv.fileErrors, []);
  xlsx.rows.forEach((row, index) => {
    const other = csv.rows[index];
    // `count` is a number cell in a text column: its text has a dot (`2.5`), the French CSV a comma.
    for (const id of ['kanap_token', 'account', 'description']) assert.equal(row.cells[id], other.cells[id], `row ${index + 2} ${id}`);
    assert.deepEqual(row.dates, other.dates, `row ${index + 2} dates`);
    for (const id of ['budget_2027', 'revision_2027']) assert.equal(amountText(row.amounts[id]), amountText(other.amounts[id]), `row ${index + 2} ${id}`);
    assert.deepEqual(row.errors, []);
  });

  // The same file saved again by LibreOffice reads with no change.
  const resaved = await readSheet(fixture('libreoffice-from-writer.xlsx'), schemaFr);
  assert.deepEqual(resaved.fileErrors, []);
  assert.deepEqual(resaved.rows, xlsx.rows);
}

async function libreOfficeFromCsv() {
  // LibreOffice's CSV import typed 01100 as the number 1100: in a text column it reads as 1100.
  const read = await readSheet(fixture('libreoffice-from-csv.xlsx'), schema('fr', ['account', 'description', 'effective_start', 'note'], ['effective_start']));
  assert.deepEqual(read.fileErrors, []);
  assert.deepEqual(read.ignoredColumns, []);
  assert.deepEqual(
    read.rows.map((row) => [row.cells.account, row.dates.effective_start, amountText(row.amounts.budget_2027), row.cells.note]),
    [
      ['1100', { kind: 'date', isoDate: '2027-12-31', time: null }, '12280.5', 'kept'],
      ['42', { kind: 'date', isoDate: '2027-02-01', time: null }, '-1234.56', 'TRUE'],
    ],
  );
}

async function typedCellsSkipSettlement() {
  // The C7 example: number cells 12280 and 1234.5, a text cell "12,280". Only the text cell is settled,
  // by the language; the typed 1234.5 is no evidence of a decimal dot, so there is no conflict.
  const headers = ['account', 'budget_2027'];
  const rows: XlsxCell[][] = [
    ['a', { kind: 'amount', value: '12280' }],
    ['b', { kind: 'amount', value: '1234.5' }],
    ['c', '12,280'],
  ];
  const fr = await readSheet(workbook(headers, rows), schema('fr', ['account']));
  assert.deepEqual(fr.fileErrors, []);
  assert.deepEqual(fr.rows.map((row) => amountText(row.amounts.budget_2027)), ['12280', '1234.5', '12.28']);
  assert.equal(fr.amounts?.decimal, ',', 'the text cell asks the question, answered by the language');
  const en = await readSheet(workbook(headers, rows), schema('en', ['account']));
  assert.deepEqual(en.rows.map((row) => amountText(row.amounts.budget_2027)), ['12280', '1234.5', '12280']);

  // In CSV, 1234.5 and 1,5 are two conventions: refused. Typed, the 1234.5 does not count.
  const csvConflict = await readCsv(Buffer.from('account;budget_2027\na;1234.5\nb;"1,5"\n'), schema('fr', ['account']));
  assert.equal(csvConflict.fileErrors.length, 1);
  const typed = await readSheet(workbook(headers, [['a', { kind: 'amount', value: '1234.5' }], ['b', '1,5']]), schema('fr', ['account']));
  assert.deepEqual(typed.fileErrors, []);
  assert.deepEqual(typed.rows.map((row) => amountText(row.amounts.budget_2027)), ['1234.5', '1.5']);

  // Dates: a typed day is no evidence of an order; text days settle among themselves.
  const dated = await readSheet(
    workbook(['account', 'end_of_validity'], [['a', { kind: 'date', iso: '2027-01-15' }], ['b', '01/03/2027'], ['c', '15/01/2027']]),
    schema('en', ['account', 'end_of_validity'], ['end_of_validity']),
  );
  assert.deepEqual(dated.fileErrors, []);
  assert.equal(dated.dates?.order, 'day-first', 'the text 15/01/2027 settles the order');
  assert.deepEqual(dated.rows.map((row) => row.dates.end_of_validity), [
    { kind: 'date', isoDate: '2027-01-15', time: null },
    { kind: 'date', isoDate: '2027-03-01', time: null },
    { kind: 'date', isoDate: '2027-01-15', time: null },
  ]);
}

async function typedCellsInOtherColumns() {
  // Text column: a number in plain notation without float noise; a text cell kept as stored.
  assert.equal(sheetCellText({ kind: 'number', value: '1100' }), '1100');
  assert.equal(sheetCellText({ kind: 'number', value: '2.4300000000000002' }), '2.43');
  assert.equal(sheetCellText({ kind: 'number', value: '0.30000000000000004' }), '0.30000000000000004', 'a real double keeps its digits');
  assert.equal(sheetCellText({ kind: 'number', value: '1.5E-3' }), '0.0015');
  assert.equal(sheetCellText({ kind: 'number', value: '-1.2E+3' }), '-1200');
  assert.equal(sheetCellText({ kind: 'number', value: '12345678901234567.89' }), '12345678901234567.89', 'more digits than a double: kept');
  assert.equal(sheetCellText({ kind: 'number', value: '-0' }), '0');
  assert.equal(sheetCellText({ kind: 'date', iso: '2027-12-31' }), '2027-12-31');
  assert.equal(sheetCellText({ kind: 'empty' }), '');

  // Hand-made: Excel's own form of numbers, in text, amount and date columns.
  const read = await readSheet(
    handmadeXlsx({
      sharedStrings: [si('account'), si('budget_2027'), si('end_of_validity'), si('01100')],
      cellXfs: [0, 14],
      sheetData:
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>2.4300000000000002</v></c><c r="C2" s="1"><v>46752</v></c></row>' +
        '<row r="3"><c r="A3"><v>1100</v></c><c r="B3"><v>0.1</v></c><c r="C3"><v>46752</v></c></row>' +
        '<row r="4"><c r="A4" t="b"><v>1</v></c><c r="B4" s="1"><v>46752</v></c><c r="C4" t="e"><v>#N/A</v></c></row>' +
        '<row r="5"><c r="A5" t="s"><v>3</v></c><c r="B5"><v>1E-30</v></c></row>' +
        '<row r="7"><c r="B7"><v>-1.5E+3</v></c></row>',
    }),
    schema('fr', ['account', 'end_of_validity'], ['end_of_validity']),
  );
  assert.deepEqual(read.fileErrors, []);
  assert.deepEqual(read.rows.map((row) => row.line), [2, 3, 4, 5, 7]);
  const [r2, r3, r4, r5, r7] = read.rows;
  assert.equal(r2.cells.account, '01100');
  assert.equal(amountText(r2.amounts.budget_2027), '2.43', 'a number cell is its amount, float noise dropped');
  assert.deepEqual(r2.dates.end_of_validity, { kind: 'date', isoDate: '2027-12-31', time: null });
  assert.equal(r3.cells.account, '1100', 'a number in a text column');
  assert.equal(amountText(r3.amounts.budget_2027), '0.1');
  assert.deepEqual(r3.errors, [{ column: 'end_of_validity', message: "Invalid date '46752'.", code: 'CSV_DATE_INVALID', params: { value: '46752' } }], 'a plain number is no date');
  assert.equal(r4.cells.account, 'TRUE');
  assert.equal(amountText(r4.amounts.budget_2027), 'invalid', 'a date is no amount');
  assert.deepEqual(r4.errors.map((error) => [error.column, error.code]), [['budget_2027', 'CSV_NUMBER_INVALID'], ['end_of_validity', 'CSV_DATE_INVALID']], 'an error cell fails its parsing');
  assert.equal(amountText(r5.amounts.budget_2027), 'invalid', 'more than 20 decimals');
  assert.deepEqual(r5.errors.map((error) => error.code), ['CSV_NUMBER_INVALID']);
  assert.equal(amountText(r7.amounts.budget_2027), '-1500');
}

async function refusals() {
  const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(100)]);
  const old = await readSheet(xls, schema('fr', ['account']));
  assert.equal(old.format, 'xlsx');
  assert.deepEqual(old.fileErrors, [XLSX_OLD_FORMAT_MESSAGE]);
  assert.equal(old.fileErrorCode, 'XLSX_OLD_FORMAT');
  assert.deepEqual(old.rows, []);

  const doctype = await readSheet(
    handmadeXlsx({ sharedStrings: [si('x')], sheetData: '', parts: { 'xl/sharedStrings.xml': '<!DOCTYPE sst><sst/>' } }),
    schema('fr', ['account']),
  );
  assert.equal(doctype.fileErrorCode, 'XLSX_DOCTYPE');
  assert.equal(doctype.fileErrors.length, 1);

  const empty = await readSheet(handmadeXlsx({ sheetData: '<row r="3"><c r="A3" t="inlineStr"><is><t>  </t></is></c></row>' }), schema('fr', ['account']));
  assert.deepEqual(empty.fileErrors, [CSV_FILE_EMPTY_MESSAGE]);
  assert.equal(empty.fileErrorCode, undefined);

  // The same row cap as CSV.
  const rows: XlsxCell[][] = Array.from({ length: CSV_ROW_CAP + 1 }, (_, index) => [`a${index}`]);
  const capped = await readSheet(workbook(['account'], rows), schema('fr', ['account']));
  assert.deepEqual(capped.fileErrors, [`This file has more than ${CSV_ROW_CAP.toLocaleString('en-US')} rows.`]);
  assert.deepEqual(capped.rows, []);
  const atCap = await readSheet(workbook(['account'], rows.slice(1)), schema('fr', ['account']));
  assert.equal(atCap.rows.length, CSV_ROW_CAP);

  // A typed cell past the header is still a cell: the row has more cells than the header.
  const extra = await readSheet(handmadeXlsx({ sheetData: '<row r="1"><c r="A1" t="inlineStr"><is><t>account</t></is></c></row><row r="2"><c r="C2"><v>1</v></c></row>' }), schema('fr', ['account']));
  assert.deepEqual(extra.rows[0].errors.map((error) => error.code), ['CSV_ROW_TOO_MANY_CELLS']);
}

async function run() {
  await dispatch();
  await writerFileReadsAsItsCsv();
  await libreOfficeFromCsv();
  await typedCellsSkipSettlement();
  await typedCellsInOtherColumns();
  await refusals();
  console.log('read-sheet.spec.ts: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
