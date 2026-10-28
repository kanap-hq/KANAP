import * as assert from 'node:assert/strict';
import { parseString } from '@fast-csv/parse';
import { AdminCoaTemplatesService } from '../../../admin/coa-templates/admin-coa-templates.service';
import { writeXlsx } from '../../xlsx';
import { withImportXlsx } from '../../__tests__/import-xlsx-flag';
import { workbookOfCsv } from '../../__tests__/workbook-of-csv';
import { CsvDecodeError } from '../decode';
import { csvSeparatorOf, readImportText } from '../read';
import { CSV_ROW_CAP } from '../types';
import { handmadeXlsx } from '../../xlsx/__tests__/fixtures/handmade';
import { minimalXls } from './office-files';

// `readImportText`, the reading of the importers that parse CSV text themselves (the field engine,
// the registers' follow-up columns, the chart of accounts templates, the incident journal): a CSV
// file is decoded as before; the first sheet of an .xlsx workbook becomes CSV text that the same
// fast-csv reading turns into the same rows as the CSV file; with the imports in CSV only
// (IMPORT_XLSX off) a workbook is refused as before.

/** Rows as the importers read them: fast-csv, headers, separator from the header, empty rows dropped. */
function rowsOf(text: string): Promise<Array<Record<string, string>>> {
  return new Promise((resolve, reject) => {
    const rows: Array<Record<string, string>> = [];
    parseString(text, { headers: true, delimiter: csvSeparatorOf(text) ?? ';', ignoreEmpty: true })
      .on('data', (row) => rows.push(row))
      .on('error', reject)
      .on('end', () => resolve(rows));
  });
}

const CSV = [
  'name;notes;amount;start_date;code',
  'Alpha;"one; two";1250,5;2027-03-01;007',
  'Beta;"say ""hi""";-3;31/12/2027;\'=SUM(A1)',
  '"Gamma, Ltd";"line one\nline two";0;;  padded  ',
  ';;;;',
  'Delta;;12;01/02/2027;X',
].join('\n');

async function testWorkbookReadsAsItsCsv() {
  const fromCsv = await rowsOf((await readImportText(Buffer.from(`﻿${CSV}`, 'utf8'))).text);
  const read = await readImportText(workbookOfCsv(CSV, 'fr'));
  assert.equal(read.format, 'xlsx');
  assert.equal(read.sheetName, 'Data');
  assert.equal(read.sheetCount, 1);
  const fromXlsx = await rowsOf(read.text);
  // Typed cells come back as the CSV would hold them for these importers: a number with a point, a
  // day as its ISO date. Every text cell, the separator, quotes and line breaks included, is the same.
  const expected: Array<Record<string, string>> = fromCsv.map((row) => ({
    ...row,
    amount: row.amount.replace(',', '.'),
    start_date: row.start_date.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$2-$1'),
  }));
  assert.deepEqual(fromXlsx, expected);
  assert.equal(fromXlsx.length, 4);
  assert.equal(fromXlsx[1].code, "'=SUM(A1)", 'the formula guard stays for the importer to undo, as in a CSV export');
  assert.equal(fromXlsx[2].code, '  padded  ', 'edge spaces kept for the importer to trim');
}

/**
 * A date-time cell keeps the time Excel shows, written as the CSV text a person would type
 * (`2026-10-02 07:51:00`); a day cell stays its ISO day. Styles: a custom `dd/mm/yyyy hh:mm`, the
 * built-in 22 and a plain day format.
 */
async function testDateTimeCells() {
  const inline = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const workbook = handmadeXlsx({
    numFmts: '<numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>',
    cellXfs: [0, 164, 22, 165],
    sheetData: [
      `<row r="1">${inline('A1', 'detected_at')}${inline('B1', 'occurred_at')}${inline('C1', 'due_date')}</row>`,
      '<row r="2"><c r="A2" s="1"><v>46297.3270833333</v></c><c r="B2" s="2"><v>45567.604166666664</v></c><c r="C2" s="3"><v>46297</v></c></row>',
      '<row r="3"><c r="A3" s="1"><v>46297</v></c><c r="B3" s="2"><v>46297.5</v></c><c r="C3" s="3"><v>46297.25</v></c></row>',
    ].join(''),
  });
  const read = await readImportText(workbook);
  assert.equal(read.text, 'detected_at;occurred_at;due_date\n2026-10-02 07:51:00;2024-10-02 14:30:00;2026-10-02\n2026-10-02 00:00:00;2026-10-02 12:00:00;2026-10-02 06:00:00');
  assert.deepEqual(await rowsOf(read.text), [
    { detected_at: '2026-10-02 07:51:00', occurred_at: '2024-10-02 14:30:00', due_date: '2026-10-02' },
    { detected_at: '2026-10-02 00:00:00', occurred_at: '2026-10-02 12:00:00', due_date: '2026-10-02 06:00:00' },
  ]);
}

async function testSheetsAndRefusals() {
  const twoSheets = await readImportText(workbookOfCsv(CSV, 'fr', { extraSheet: true }));
  assert.deepEqual([twoSheets.sheetName, twoSheets.sheetCount], ['Data', 2]);

  const refusal = async (bytes: Buffer): Promise<{ status?: number; code?: string; message?: string }> => {
    try {
      await readImportText(bytes);
      return {};
    } catch (err: any) {
      if (err instanceof CsvDecodeError) return { code: err.code, message: err.message };
      const body = err.getResponse();
      return { status: err.getStatus(), code: body.code, message: typeof body === 'string' ? body : body.message };
    }
  };
  assert.equal((await refusal(minimalXls())).code, 'XLSX_OLD_FORMAT');
  assert.equal((await refusal(minimalXls())).status, 400);
  assert.equal((await refusal(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).code, 'XLSX_NOT_WORKBOOK');
  // Past the import's row cap: the CSV row-cap sentence.
  const many = writeXlsx({ language: 'en', sheets: [{ name: 'Rows', headers: ['name'], rows: Array.from({ length: CSV_ROW_CAP + 200 }, (_, i) => [`row ${i}`]) }] });
  assert.equal((await refusal(many)).message, `This file has more than ${CSV_ROW_CAP.toLocaleString('en-US')} rows.`);

  await withImportXlsx(false, async () => {
    assert.equal((await refusal(workbookOfCsv(CSV, 'fr'))).code, 'CSV_FILE_EXCEL');
    assert.equal((await refusal(minimalXls())).code, 'CSV_FILE_EXCEL');
    assert.equal((await readImportText(Buffer.from(CSV, 'utf8'))).format, 'csv');
  });
}

/** A chart of accounts template in .xlsx: the same check as its CSV, and the sheet named when there are two. */
async function testCoaTemplate() {
  const service = new AdminCoaTemplatesService(undefined as any, undefined as any);
  const template = [
    'account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature',
    '6100;Fournitures;Fournitures;Office;4000;Consolidated;;enabled;opex',
    '2154;Machines;Machines;;;;;enabled;capex',
    '6200;Services;Services;;4000;Consolidated;;enabled;wrong',
  ].join('\n');
  const upload = (buffer: Buffer) => ({ buffer }) as Express.Multer.File;
  const fromCsv = await service.importCsv('t1', upload(Buffer.from(template, 'utf8')), true);
  const fromXlsx = await service.importCsv('t1', upload(workbookOfCsv(template, 'fr')), true);
  assert.equal(fromCsv.ok, false);
  assert.deepEqual(fromXlsx, fromCsv);
  const twoSheets: any = await service.importCsv('t1', upload(workbookOfCsv(template, 'fr', { extraSheet: true })), true);
  assert.equal(twoSheets.notices?.firstSheetOnly, 'Data');
  assert.deepEqual(twoSheets.errors, fromCsv.errors);
}

async function main() {
  await testWorkbookReadsAsItsCsv();
  await testDateTimeCells();
  await testSheetsAndRefusals();
  await testCoaTemplate();
  console.log('import-text.spec: all assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
