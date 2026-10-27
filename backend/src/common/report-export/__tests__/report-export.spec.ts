import * as assert from 'node:assert/strict';
import AdmZip = require('adm-zip');
import { DATA_ACCESS_HEADER } from '../../../data-access/data-access';
import { XLSX_CONTENT_TYPE } from '../../xlsx';
import { REPORT_EXPORT_LABELS, reportExportBody, ReportExport, ReportExportRequest, writeReportExport } from '../index';

/** The shared report table file: CSV and xlsx of a two-table export, Parameters, footers, `table=`, counts, headers. */

const exportOf = (limited = false): ReportExport => ({
  fileBase: 'probe-report',
  limited,
  parameters: [['Months', '6'], ['Teams', 'Alpha, Beta']],
  tables: [
    {
      key: 'people',
      sheet: 'People',
      columns: [
        { header: 'Name', kind: 'text' },
        { header: 'Days', kind: 'number' },
        { header: 'Cost', kind: 'amount' },
        { header: 'Month', kind: 'date' },
        { header: 'Share', kind: 'percent' },
      ],
      rows: [
        ['=Ann', { kind: 'number', value: 3.5 }, { kind: 'amount', value: '-1234.50' }, { kind: 'date', iso: '2026-09-01' }, { kind: 'percent', value: 0.125 }],
        ['Bob', null, { kind: 'amount', value: '10.00' }, null, null],
      ],
      footer: [['Total', { kind: 'number', value: 3.5 }, { kind: 'amount', value: '-1224.50' }, null, { kind: 'percent', value: 1 }]],
    },
    {
      key: 'teams',
      sheet: 'Teams',
      columns: [{ header: 'Team', kind: 'text' }, { header: 'Members', kind: 'number' }],
      rows: [['Alpha', { kind: 'number', value: 2 }]],
    },
  ],
});

const request = (over: Partial<ReportExportRequest> = {}): ReportExportRequest => ({
  format: 'csv',
  language: 'fr',
  timeZone: 'Europe/Paris',
  generatedAt: new Date('2026-10-26T23:30:00Z'), // 27 October in Paris
  generatedBy: 'Claire Martin',
  ...over,
});

const csvText = (body: Buffer) => body.toString('utf8').replace(/^﻿/, '');
const sheetText = (zip: AdmZip, index: number) => zip.readAsText(`xl/worksheets/sheet${index}.xml`);
const cellTexts = (xml: string) => [...xml.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map((m) => m[1]);

function csv() {
  const file = writeReportExport(exportOf(), request({ table: 'people' }));
  assert.equal(file.filename, 'probe-report-people-2026-10-27.csv', 'table key and the day in the user zone');
  assert.equal(file.contentType, 'text/csv; charset=utf-8');
  assert.equal(file.rows, 2, 'data rows only');
  assert.equal(
    csvText(file.body),
    [
      'Name;Days;Cost;Month;Share',
      "'=Ann;3,5;-1234,50;01/09/2026;12,50%",
      'Bob;;10,00;;',
      'Total;3,5;-1224,50;;100,00%',
      '',
    ].join('\n'),
    'French CSV: separator, decimal comma, French day, percent, formula guard, footer last',
  );
  assert.ok(file.body.toString('utf8').startsWith('﻿'), 'BOM');
  const en = writeReportExport(exportOf(), request({ language: 'en', table: 'people' }));
  assert.equal(csvText(en.body).split('\n')[1], "'=Ann,3.5,-1234.50,2026-09-01,12.50%", 'English CSV');
  const teams = writeReportExport(exportOf(), request({ table: 'teams' }));
  assert.equal(csvText(teams.body), 'Team;Members\nAlpha;2\n');
  assert.equal(teams.rows, 1);

  // `table=` rules: required with several tables, refused when unknown, optional with one.
  assert.throws(() => writeReportExport(exportOf(), request()), (e: any) => e.getStatus?.() === 400 && /table is required/.test(e.message));
  assert.throws(() => writeReportExport(exportOf(), request({ table: 'other' })), (e: any) => e.getStatus?.() === 400 && /table must be one of people, teams/.test(e.message));
  const single: ReportExport = { ...exportOf(), tables: [exportOf().tables[1]] };
  assert.equal(writeReportExport(single, request()).filename, 'probe-report-2026-10-27.csv', 'one table: no key in the name');
  assert.throws(() => writeReportExport(single, request({ table: 'people' })), (e: any) => e.getStatus?.() === 400);

  // Limited: no total row.
  const limited = writeReportExport(exportOf(true), request({ table: 'people' }));
  assert.ok(!csvText(limited.body).includes('Total'), 'footer dropped when limited');
  assert.equal(limited.rows, 2);
  assert.equal(limited.limited, true);
}

function xlsx() {
  const file = writeReportExport(exportOf(), request({ format: 'xlsx' }));
  assert.equal(file.filename, 'probe-report-2026-10-27.xlsx');
  assert.equal(file.contentType, XLSX_CONTENT_TYPE);
  assert.equal(file.rows, 3, 'data rows of every table');
  const zip = new AdmZip(file.body);
  const names = [...zip.readAsText('xl/workbook.xml').matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ['People', 'Teams', 'Paramètres'], 'one sheet per table, then the translated Parameters');
  const people = sheetText(zip, 1);
  assert.ok(people.includes('<c r="B2"><v>3.5</v></c>'), 'number cell');
  assert.ok(people.includes('<c r="C2" s="3"><v>-1234.50</v></c>'), 'amount cell');
  assert.ok(people.includes('<c r="D2" s="1"><v>46266</v></c>'), 'date cell');
  assert.ok(people.includes('<c r="E2" s="4"><v>0.125</v></c>'), 'percent cell');
  assert.ok(people.includes('<row r="4"><c r="A4" s="2" t="inlineStr"><is><t xml:space="preserve">Total</t>'), 'footer after the data rows, bold');
  assert.ok(people.includes('<autoFilter ref="A1:E3"/>'), 'the filter leaves the footer out');
  assert.deepEqual(cellTexts(sheetText(zip, 3)), [
    'Paramètre', 'Valeur', 'Months', '6', 'Teams', 'Alpha, Beta', 'Généré le', '27/10/2026 00:30 (Europe/Paris)', 'Généré par', 'Claire Martin',
  ], 'parameters, then the generation time in the user zone and the user');

  const limited = new AdmZip(writeReportExport(exportOf(true), request({ format: 'xlsx', language: 'en', timeZone: 'UTC' })).body);
  assert.ok(!sheetText(limited, 1).includes('Total'), 'footer dropped when limited');
  assert.deepEqual(cellTexts(sheetText(limited, 3)).slice(-5), ['Generated on', '2026-10-26 23:30 UTC', 'Generated by', 'Claire Martin', 'Computed on your access'], 'the access line');
  assert.equal(REPORT_EXPORT_LABELS.en.computedOnYourAccess, 'Computed on your access');

  // A valid `table` puts its sheet first; an unknown one is refused.
  const first = new AdmZip(writeReportExport(exportOf(), request({ format: 'xlsx', table: 'teams' })).body);
  assert.deepEqual([...first.readAsText('xl/workbook.xml').matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]), ['Teams', 'People', 'Paramètres']);
  assert.throws(() => writeReportExport(exportOf(), request({ format: 'xlsx', table: 'x' })), (e: any) => e.getStatus?.() === 400);
}

function mistakes() {
  const bad = (rows: any[][]): ReportExport => ({ ...exportOf(), tables: [{ key: 't', sheet: 'T', columns: [{ header: 'A', kind: 'number' }], rows }] });
  assert.throws(() => writeReportExport(bad([['3']]), request()), /is text, the column is number/);
  assert.throws(() => writeReportExport(bad([[{ kind: 'number', value: 1 }, null]]), request()), /2 cells for 1 columns/);
  assert.throws(() => writeReportExport(bad([[{ kind: 'number', value: NaN }]]), request()), /finite/);
  assert.throws(() => writeReportExport({ ...exportOf(), tables: [] }, request()), /no table/);
  const amount: ReportExport = { ...exportOf(), tables: [{ key: 't', sheet: 'T', columns: [{ header: 'A', kind: 'amount' }], rows: [[{ kind: 'amount', value: '1,5' }]] }] };
  assert.throws(() => writeReportExport(amount, request({ format: 'xlsx' })), /not a decimal amount/);
  assert.equal(csvText(writeReportExport(bad([[{ kind: 'number', value: 1e-7 }]]), request({ language: 'en' })).body), 'A\n0.0000001\n', 'no exponent');
}

async function body() {
  const headers: Record<string, string> = {};
  const res: any = { setHeader: (name: string, value: string) => { headers[name] = value; } };
  const file = writeReportExport(exportOf(true), request({ table: 'teams' }));
  const sent = await reportExportBody(res, file);
  assert.equal(sent, file.body);
  assert.equal(headers['Content-Type'], 'text/csv; charset=utf-8');
  assert.equal(headers['Content-Disposition'], 'attachment; filename="probe-report-teams-2026-10-27.csv"');
  assert.equal(headers[DATA_ACCESS_HEADER], 'limited');
  const open: Record<string, string> = {};
  await reportExportBody({ setHeader: (name: string, value: string) => { open[name] = value; } } as any, writeReportExport(exportOf(), request({ table: 'teams' })));
  assert.ok(!(DATA_ACCESS_HEADER in open), 'no access header when not limited');
}

async function main() {
  csv();
  xlsx();
  mistakes();
  await body();
  console.log('report-export.spec.ts: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
