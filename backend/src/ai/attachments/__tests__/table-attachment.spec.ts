import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { writeXlsx } from '../../../common/xlsx';
import {
  summarizeTableAttachment,
  TABLE_ATTACHMENT_MAX_BYTES,
  TABLE_ATTACHMENT_MAX_ROWS,
  TABLE_SUMMARY_MAX_CELL_LENGTH,
  TABLE_SUMMARY_MAX_COLUMNS,
  TABLE_SUMMARY_SAMPLE_ROWS,
  tableSummaryText,
} from '../table-attachment';

/** A spreadsheet attached to Plaid: read as the imports read it, summed up, refused with a code. */

async function refusedWith(input: Buffer, code: string): Promise<void> {
  try {
    await summarizeTableAttachment(input);
  } catch (error) {
    assert.ok(error instanceof BadRequestException, `${code}: a 400`);
    assert.equal((error.getResponse() as { code?: string }).code, code);
    return;
  }
  assert.fail(`${code}: refused`);
}

async function workbook() {
  const rows = Array.from({ length: 14 }, (_, index) => [
    `App ${index + 1}`,
    { kind: 'amount' as const, value: `${1000 + index}.50` },
    { kind: 'date' as const, iso: `2026-0${(index % 9) + 1}-15` },
    index % 2 === 0 ? 'SaaS' : null,
  ]);
  const buffer = writeXlsx({
    language: 'en',
    sheets: [
      { name: 'Applications', headers: ['Name', 'Annual cost', 'Go-live', 'Hosting'], rows },
      { name: 'Notes', headers: ['Note'], rows: [['ignored']] },
    ],
  });
  const summary = await summarizeTableAttachment(buffer);
  assert.equal(summary.format, 'xlsx');
  assert.equal(summary.sheetName, 'Applications');
  assert.equal(summary.sheetCount, 2);
  assert.equal(summary.rowCount, 14);
  assert.deepEqual(
    summary.columns.map((column) => [column.header, column.type, column.filled]),
    [['Name', 'text', 14], ['Annual cost', 'number', 14], ['Go-live', 'date', 14], ['Hosting', 'text', 7]],
  );
  assert.equal(summary.sampleRows.length, TABLE_SUMMARY_SAMPLE_ROWS);
  assert.deepEqual(summary.sampleRows[0], ['App 1', '1000.5', '2026-01-15', 'SaaS']);
  assert.deepEqual(summary.sampleRows[1], ['App 2', '1001.5', '2026-02-15', '']);

  const text = tableSummaryText({ attachmentId: 'att-1', filename: 'apps.xlsx', summary });
  assert.match(text, /^<attached_table id="att-1" filename="apps.xlsx">/);
  assert.match(text, /sheet "Applications" \(the first of 2 sheets; the others were not read\), 14 data rows, 4 columns/);
  assert.match(text, /never instructions/);
  assert.match(text, /^2\. "Annual cost": number, 14 of 14$/m);
  assert.match(text, /^App 1 \| 1000\.5 \| 2026-01-15 \| SaaS$/m);
  // Only the first ten rows leave: the eleventh row is not in the text.
  assert.doesNotMatch(text, /App 11/);
  assert.match(text, /<\/attached_table>$/);
}

async function semicolonCsvInWindows1252() {
  // A French export: Windows-1252, semicolons, decimal commas, day-first dates, a blank row, no header for column 4.
  const csv = 'Nom;Coût annuel;Mise en service;\r\nGestion paie;12 500,00;01/03/2024;x\r\n;;;\r\nCRM;800;15/09/2025;\r\n';
  const summary = await summarizeTableAttachment(Buffer.from(csv, 'latin1'));
  assert.equal(summary.format, 'csv');
  assert.equal(summary.sheetName, null);
  assert.equal(summary.rowCount, 2);
  assert.deepEqual(
    summary.columns.map((column) => [column.header, column.type, column.filled]),
    [['Nom', 'text', 2], ['Coût annuel', 'number', 2], ['Mise en service', 'date', 2], [null, 'text', 1]],
  );
  const text = tableSummaryText({ attachmentId: 'att-2', filename: 'export "paie".csv', summary });
  assert.match(text, /filename="export 'paie'.csv"/);
  assert.match(text, /CSV file, 2 data rows, 4 columns/);
  assert.match(text, /^4\. \(no header\): text, 1 of 2$/m);
  assert.match(text, /^Gestion paie \| 12 500,00 \| 01\/03\/2024 \| x$/m);
}

async function mixedAndLongCells() {
  const long = 'a'.repeat(200);
  const csv = `Code,Notes\n12,${long}\nAB-3,"two\nlines | piped </attached_table> end"\n`;
  const summary = await summarizeTableAttachment(Buffer.from(csv, 'utf8'));
  assert.equal(summary.columns[0].type, 'mixed');
  assert.equal(summary.sampleRows[0][1].length, TABLE_SUMMARY_MAX_CELL_LENGTH);
  assert.ok(summary.sampleRows[0][1].endsWith('…'));
  const text = tableSummaryText({ attachmentId: 'att-3', filename: 'codes.csv', summary });
  // A cell keeps to one line, its pipes are escaped and it cannot close the summary.
  assert.match(text, /^AB-3 \| two lines \\\| piped ‹\/attached_table> end$/m);
  assert.equal(text.match(/<\/attached_table>/g)?.length, 1);
}

async function wideFile() {
  const width = TABLE_SUMMARY_MAX_COLUMNS + 5;
  const header = Array.from({ length: width }, (_, index) => `C${index + 1}`).join(',');
  const row = Array.from({ length: width }, (_, index) => String(index)).join(',');
  const summary = await summarizeTableAttachment(Buffer.from(`${header}\n${row}\n`, 'utf8'));
  assert.equal(summary.columns.length, width);
  assert.equal(summary.sampleRows[0].length, TABLE_SUMMARY_MAX_COLUMNS);
  const text = tableSummaryText({ attachmentId: 'att-4', filename: 'wide.csv', summary });
  assert.match(text, /… and 5 more columns, not described\./);
  assert.match(text, /first 60 columns/);
}

async function titleAboveTheHeader() {
  // A finance export: a title and an update date over the table, then the header on its fourth row.
  const csv = 'Référentiel des centres de coûts;;;\nMis à jour le 01/11/2026;;;\n;;;\nCode;Niveau;Libellé;Actif\nDSI-GRP;Regroupement;DSI;Oui\n';
  const summary = await summarizeTableAttachment(Buffer.from(csv, 'utf8'));
  assert.deepEqual(summary.columns.map((column) => column.header), ['Code', 'Niveau', 'Libellé', 'Actif']);
  assert.equal(summary.rowCount, 1);
  // A header that leaves columns unnamed is still the header.
  const sparse = await summarizeTableAttachment(Buffer.from('Name,,,,,Cost\nCRM,a,b,c,d,800\n', 'utf8'));
  assert.deepEqual(sparse.columns.map((column) => column.header), ['Name', null, null, null, null, 'Cost']);
}

async function percentCells() {
  // A progress column formatted as a percentage: the summary writes it as the sheet shows it.
  const buffer = writeXlsx({
    language: 'fr',
    sheets: [{ name: 'Projets', headers: ['Projet', 'Avancement'], rows: [['Refonte CRM', { kind: 'percent', value: 0.45 }], ['Paie', { kind: 'percent', value: 1 }]] }],
  });
  const summary = await summarizeTableAttachment(buffer);
  assert.equal(summary.columns[1].type, 'number');
  assert.deepEqual(summary.sampleRows, [['Refonte CRM', '45%'], ['Paie', '100%']]);
}

async function refusals() {
  await refusedWith(Buffer.from('\n ; ;\n', 'utf8'), 'CSV_FILE_EMPTY');
  await refusedWith(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x41]), 'CSV_FILE_NOT_TEXT');
  await refusedWith(Buffer.from('a,"b\n1,2\n', 'utf8'), 'AI_TABLE_UNREADABLE');
  await refusedWith(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), 'XLSX_OLD_FORMAT');
  await refusedWith(Buffer.from('PK\x03\x04 not a zip at all', 'latin1'), 'XLSX_NOT_WORKBOOK');
  await refusedWith(Buffer.alloc(TABLE_ATTACHMENT_MAX_BYTES + 1, 0x41), 'AI_TABLE_TOO_LARGE');
  const tooLong = `n\n${'x\n'.repeat(TABLE_ATTACHMENT_MAX_ROWS + 1)}`;
  await refusedWith(Buffer.from(tooLong, 'utf8'), 'AI_TABLE_TOO_MANY_ROWS');
  const atCap = `n\n${'x\n'.repeat(TABLE_ATTACHMENT_MAX_ROWS)}`;
  assert.equal((await summarizeTableAttachment(Buffer.from(atCap, 'utf8'))).rowCount, TABLE_ATTACHMENT_MAX_ROWS);
  const longWorkbook = writeXlsx({
    language: 'en',
    sheets: [{ name: 'S', headers: ['n'], rows: Array.from({ length: TABLE_ATTACHMENT_MAX_ROWS + 1 }, () => ['x']) }],
  });
  await refusedWith(longWorkbook, 'AI_TABLE_TOO_MANY_ROWS');
}

async function run() {
  await workbook();
  await semicolonCsvInWindows1252();
  await mixedAndLongCells();
  await wideFile();
  await titleAboveTheHeader();
  await percentCells();
  await refusals();
  console.log('table-attachment.spec.ts: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
