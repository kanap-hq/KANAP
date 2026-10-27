import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse } from 'csv-parse/sync';
import type { CsvLanguage } from '../csv-sheet/types';
import { writeXlsx, XlsxCell } from '../xlsx';

/**
 * The workbook a person makes of a CSV file by opening it in a spreadsheet and saving it as .xlsx,
 * written by the xlsx writer of the exports: the first row is the header, a cell that reads as a
 * number in `language` (`1250,5` in French, `1250.5` in English, no leading zero) becomes a number
 * cell, a day (`2027-03-01`, or `01/03/2027` and `01.03.2027` day first outside English) a date
 * cell, anything else stays text. `extraSheet` adds a second sheet after the first, which the
 * imports leave unread.
 */
export function workbookOfCsv(csv: string, language: CsvLanguage, options: { extraSheet?: boolean } = {}): Buffer {
  const text = csv.replace(/^﻿/, '');
  const header = text.split('\n')[0];
  const delimiter = header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',';
  const records: string[][] = parse(text, { delimiter, relax_column_count: true, skip_empty_lines: true });
  const [headers, ...rows] = records;
  const sheets = [{ name: 'Data', headers, rows: rows.map((row) => row.map((cell) => typedCell(cell, language))) }];
  if (options.extraSheet) sheets.push({ name: 'Notes', headers: ['note'], rows: [['not read']] });
  return writeXlsx({ language, sheets });
}

function typedCell(cell: string, language: CsvLanguage): XlsxCell {
  if (cell === '') return null;
  const decimal = language === 'en' ? '\\.' : ',';
  const number = new RegExp(`^-?(0|[1-9]\\d{0,14})(${decimal}\\d{1,6})?$`).exec(cell);
  if (number) return { kind: 'number', value: Number(cell.replace(',', '.')) };
  if (/^\d{4}-\d{2}-\d{2}$/.test(cell)) return { kind: 'date', iso: cell };
  const dayFirst = language === 'en' ? null : /^(\d{2})[/.](\d{2})[/.](\d{4})$/.exec(cell);
  if (dayFirst) return { kind: 'date', iso: `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}` };
  return cell;
}

/** True when LibreOffice (`soffice`) is installed, for the round trips that need it. */
export function hasLibreOffice(): boolean {
  return spawnSync('which', ['soffice'], { encoding: 'utf8' }).status === 0;
}

/** The workbook opened and saved again as .xlsx by LibreOffice (`soffice --convert-to xlsx`). */
export function throughLibreOffice(workbook: Buffer): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-xlsx-'));
  try {
    const input = path.join(dir, 'in', 'file.xlsx');
    fs.mkdirSync(path.dirname(input));
    fs.writeFileSync(input, workbook);
    const out = path.join(dir, 'out');
    const run = spawnSync(
      'soffice',
      [`-env:UserInstallation=file://${path.join(dir, 'profile')}`, '--headless', '--convert-to', 'xlsx', '--outdir', out, input],
      { encoding: 'utf8', timeout: 120_000 },
    );
    assert.equal(run.status, 0, `soffice: ${run.stderr}`);
    return fs.readFileSync(path.join(out, 'file.xlsx'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
