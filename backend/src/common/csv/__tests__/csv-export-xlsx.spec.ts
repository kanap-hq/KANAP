import * as assert from 'node:assert/strict';
import AdmZip = require('adm-zip');
import { parseString } from '@fast-csv/parse';
import { CsvExportService, csvExportFormat } from '../csv-export.service';
import { CsvResolverService } from '../csv-resolver.service';
import { CsvFieldType } from '../csv-field.types';
import { XLSX_CONTENT_TYPE } from '../../xlsx';
import { daySerial } from '../../xlsx/write';
import { goldenCases, goldenManager } from './csv-export-golden.spec';

// The six field-engine lists in xlsx (Excel export, lot 3): the CSV in another container. For every
// list of the golden seed, in French: one styled sheet named after the list, the CSV's headers in its
// order, a number field as a number cell, a date field as a date cell (the day's serial, style 1), and
// every other cell the very text of the CSV cell, formula guard included.

type SheetCell = { type: 'text'; text: string } | { type: 'number'; value: string; style: string | null };

function sheetCells(xml: string): Map<string, SheetCell> {
  const cells = new Map<string, SheetCell>();
  for (const match of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>(.*?)<\/c>/gs)) {
    const [, ref, attributes, body] = match;
    if (/t="inlineStr"/.test(attributes)) {
      const text = /<t[^>]*>(.*?)<\/t>/s.exec(body)?.[1] ?? '';
      cells.set(ref, { type: 'text', text: unescapeXml(text) });
    } else {
      cells.set(ref, { type: 'number', value: /<v>(.*?)<\/v>/.exec(body)?.[1] ?? '', style: /s="(\d+)"/.exec(attributes)?.[1] ?? null });
    }
  }
  return cells;
}

function unescapeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

async function csvTable(text: string): Promise<string[][]> {
  const rows: string[][] = [];
  await new Promise<void>((resolve, reject) => {
    parseString(text.replace(/^﻿/, ''), { delimiter: ';', headers: false })
      .on('data', (row: string[]) => rows.push(row))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return rows;
}

async function testSixLists() {
  const service = new CsvExportService(new CsvResolverService());
  const sheetNames: Record<string, string> = {
    applications: 'Applications',
    assets: 'Actifs',
    incidents: 'Registre des incidents',
    projects: 'Projets du portefeuille',
    requests: 'Demandes du portefeuille',
    tasks: 'Tâches',
  };
  let numberCells = 0;
  let dateCells = 0;
  let guarded = 0;
  for (const golden of goldenCases()) {
    const options = { manager: goldenManager(), tenantId: 'tenant-1', language: 'fr' as const, timeZone: golden.timeZone };
    const csv = await service.export(golden.config, golden.rows, options);
    const xlsx = await service.export(golden.config, golden.rows, { ...options, format: 'xlsx' });
    assert.equal(xlsx.filename, csv.filename.replace(/\.csv$/, '.xlsx'), `${golden.name}: the file name of the CSV, in .xlsx`);
    assert.equal(xlsx.contentType, XLSX_CONTENT_TYPE);
    assert.equal(xlsx.rows, csv.rows);
    assert.ok(Buffer.isBuffer(xlsx.content));
    const zip = new AdmZip(xlsx.content);
    const workbook = zip.readAsText('xl/workbook.xml');
    assert.equal([...workbook.matchAll(/<sheet /g)].length, 1, `${golden.name}: one sheet`);
    assert.match(workbook, new RegExp(`<sheet name="${sheetNames[golden.name]}" sheetId="1"`), `${golden.name}: the sheet is named after the list, in French`);
    const sheet = zip.readAsText('xl/worksheets/sheet1.xml');
    assert.match(sheet, /state="frozen"/, `${golden.name}: styled sheet (frozen header)`);
    assert.match(sheet, /<autoFilter /, `${golden.name}: styled sheet (filter)`);

    const table = await csvTable(csv.content);
    const cells = sheetCells(sheet);
    const [headers, ...rows] = table;
    headers.forEach((header, index) => {
      const cell = cells.get(`${columnName(index)}1`);
      assert.deepEqual(cell, { type: 'text', text: header }, `${golden.name}: header ${index + 1} as in the CSV`);
    });
    // The type of each column, by its French header (without the zone a date-time header names).
    const typeOf = new Map(golden.config.fields.filter((field) => !field.exportFn)
      .map((field) => [golden.config.headerLabels?.[field.csvColumn]?.fr ?? field.csvColumn, field.type]));
    rows.forEach((row, rowIndex) => {
      row.forEach((text, index) => {
        const ref = `${columnName(index)}${rowIndex + 2}`;
        const cell = cells.get(ref);
        const type = typeOf.get(headers[index].replace(/ \(.*\)$/, ''));
        if (text === '') {
          assert.equal(cell, undefined, `${golden.name} ${ref}: empty`);
          return;
        }
        if (type === CsvFieldType.NUMBER && cell?.type === 'number') {
          numberCells += 1;
          assert.equal(cell.style, null, `${golden.name} ${ref}: a number in General format`);
          assert.equal(Number(cell.value), Number(text.replace(',', '.')), `${golden.name} ${ref}: the number of the CSV`);
          return;
        }
        if (type === CsvFieldType.DATE && cell?.type === 'number') {
          dateCells += 1;
          assert.equal(cell.style, '1', `${golden.name} ${ref}: a date cell`);
          const [day, month, year] = text.split('/');
          assert.equal(Number(cell.value), daySerial(`${year}-${month}-${day}`), `${golden.name} ${ref}: the day of the CSV as a serial`);
          return;
        }
        assert.deepEqual(cell, { type: 'text', text }, `${golden.name} ${ref}: the text of the CSV`);
        if (text.startsWith("'=") || text.startsWith("'+") || text.startsWith("'@")) guarded += 1;
      });
    });
  }
  assert.ok(numberCells >= 10, `number cells checked (${numberCells})`);
  assert.ok(dateCells >= 20, `date cells checked (${dateCells})`);
  assert.ok(guarded >= 6, `formula-guarded text cells checked (${guarded})`);
  console.log(`  six lists: sheet, headers, ${numberCells} number cells, ${dateCells} date cells, every text cell as the CSV (${guarded} guarded): OK`);
}

/** A value the CSV cannot read as a number or a day stays the CSV's text; a decimal string never goes through a float. */
async function testTypedCells() {
  const service = new CsvExportService(new CsvResolverService());
  const config = {
    entityName: 'probe',
    tableName: 'probes',
    displayName: 'Probes',
    upsertKey: ['name'],
    fields: [
      { csvColumn: 'name', entityProperty: 'name', type: CsvFieldType.STRING },
      { csvColumn: 'effort', entityProperty: 'effort', type: CsvFieldType.NUMBER },
      { csvColumn: 'day', entityProperty: 'day', type: CsvFieldType.DATE },
    ],
  };
  const rows = [
    { name: '@SUM(1)', effort: '1234567.89', day: '1899-12-31' },
    { name: 'b', effort: 'n/a', day: '2026-02-30' },
    { name: 'c', effort: -0.5, day: new Date(2026, 0, 31) },
  ];
  const file = await service.export(config, rows, { manager: goldenManager(), tenantId: 't', language: 'de', format: 'xlsx' });
  const cells = sheetCells(new AdmZip(file.content).readAsText('xl/worksheets/sheet1.xml'));
  assert.deepEqual(cells.get('A2'), { type: 'text', text: "'@SUM(1)" }, 'formula guard');
  assert.deepEqual(cells.get('B2'), { type: 'number', value: '1234567.89', style: null }, 'the decimal text, exactly');
  assert.deepEqual(cells.get('C2'), { type: 'text', text: '31.12.1899' }, 'a day before 1900-03-01 is text in the language');
  assert.deepEqual(cells.get('B3'), { type: 'text', text: 'n/a' }, 'not a number: the CSV text');
  assert.deepEqual(cells.get('C3'), { type: 'text', text: '2026-02-30' }, 'not a day: the CSV text');
  assert.deepEqual(cells.get('B4'), { type: 'number', value: '-0.5', style: null });
  assert.deepEqual(cells.get('C4'), { type: 'number', value: String(daySerial('2026-01-31')), style: '1' }, 'a Date (a `date` column, local midnight): its day in the server\'s zone, as the CSV');
  assert.match(new AdmZip(file.content).readAsText('xl/workbook.xml'), /<sheet name="Probes"/, 'displayName without sheetNames');
  console.log('  typed cells: exact decimals, CSV text for what is neither a number nor a day: OK');
}

/**
 * Each list carries the business reference its screen shows, right after `id` (the incident register
 * has no id: its reference leads), as a text cell; it is export only, so the import template leaves it out.
 */
async function testReferences() {
  const service = new CsvExportService(new CsvResolverService());
  const expected: Record<string, { headers: string[]; first: string }> = {
    applications: { headers: ['id', 'reference', 'name'], first: 'APP-1' },
    assets: { headers: ['id', 'reference', 'name'], first: 'AST-1' },
    incidents: { headers: ['Réf.', 'Titre'], first: 'INC-1' },
    projects: { headers: ['id', 'reference', 'name'], first: 'PRJ-1' },
    requests: { headers: ['id', 'reference', 'name'], first: 'REQ-1' },
    tasks: { headers: ['id', 'reference', 'title'], first: 'T-1' },
  };
  for (const golden of goldenCases()) {
    const { headers, first } = expected[golden.name];
    const options = { manager: goldenManager(), tenantId: 'tenant-1', language: 'fr' as const, timeZone: golden.timeZone };
    const xlsx = await service.export(golden.config, golden.rows, { ...options, format: 'xlsx' });
    const cells = sheetCells(new AdmZip(xlsx.content).readAsText('xl/worksheets/sheet1.xml'));
    headers.forEach((header, index) => {
      assert.deepEqual(cells.get(`${columnName(index)}1`), { type: 'text', text: header }, `${golden.name}: column ${index + 1} is ${header}`);
    });
    const referenceColumn = columnName(headers.length === 2 ? 0 : 1);
    assert.deepEqual(cells.get(`${referenceColumn}2`), { type: 'text', text: first }, `${golden.name}: the reference as text`);
    if (golden.name === 'incidents') continue;
    assert.equal(cells.get(`${referenceColumn}4`), undefined, `${golden.name}: no number, no reference`);
    const reference = golden.config.fields.find((field) => field.csvColumn === 'reference');
    assert.equal(reference?.importable, false, `${golden.name}: the reference is export only`);
    const template = await service.export(golden.config, [], { ...options, scope: 'template' });
    assert.ok(!(await csvTable(template.content))[0].includes('reference'), `${golden.name}: the template leaves the reference out`);
  }
  console.log('  references: after id, text cells, left out of the import template: OK');
}

async function testTemplateIsCsv() {
  const service = new CsvExportService(new CsvResolverService());
  const [golden] = goldenCases();
  await assert.rejects(
    service.export(golden.config, [], { manager: goldenManager(), tenantId: 't', language: 'fr', scope: 'template', format: 'xlsx' }),
    (error: any) => error?.getStatus?.() === 400,
  );
  assert.throws(() => csvExportFormat('xlsx', 'template'), (error: any) => error?.getStatus?.() === 400);
  assert.throws(() => csvExportFormat('ods', 'data'), (error: any) => error?.getStatus?.() === 400);
  assert.equal(csvExportFormat(undefined, 'template'), 'csv');
  assert.equal(csvExportFormat('XLSX', 'data'), 'xlsx');
  assert.equal(csvExportFormat('csv', 'template'), 'csv');
  console.log('  template: CSV only, xlsx answers 400; unknown format 400: OK');
}

async function run() {
  console.log('csv export xlsx');
  await testSixLists();
  await testTypedCells();
  await testReferences();
  await testTemplateIsCsv();
  console.log('csv-export-xlsx.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
