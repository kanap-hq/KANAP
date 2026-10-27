import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import AdmZip = require('adm-zip');
import { backendPath } from '../../__tests__/backend-root';

// The CSV of the exports that have a plain export button (audit log, contract compliance register,
// vulnerabilities, administration view, applications of a technology), byte for byte, as each one
// wrote it before the Excel export (lot 3, run C): the files in `golden/exports/` must not change.
// `UPDATE_CSV_GOLDEN=1` rewrites them (never to make a failing run pass: a difference is a change of
// the CSV people already use). `mask` replaces what a run cannot fix (today's date, generated ids)
// before the comparison, the same way when the file is written.

const GOLDEN_DIR = backendPath('src', 'common', 'csv', '__tests__', 'golden', 'exports');

export function assertCsvGolden(name: string, content: string | Buffer, mask: (text: string) => string = (text) => text): void {
  assert.equal(typeof content, 'string', `${name}: a CSV export is text`);
  const text = mask(content as string);
  assert.ok(text.split('\n').filter(Boolean).length >= 2, `${name}: rows exported`);
  const file = path.join(GOLDEN_DIR, `${name}.csv`);
  if (process.env.UPDATE_CSV_GOLDEN === '1') {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, text);
    return;
  }
  assert.ok(fs.existsSync(file), `${name}.csv: golden file present`);
  assert.equal(text, fs.readFileSync(file, 'utf8'), `${name}.csv: byte-identical`);
}

/** The cells of the first sheet of a workbook: `{ ref: [style or 'text', value] }` (`general` without a style). */
export function xlsxCells(content: string | Buffer): Record<string, [string, string]> {
  assert.ok(Buffer.isBuffer(content), 'a workbook');
  const xml = new AdmZip(content).readAsText('xl/worksheets/sheet1.xml');
  const cells: Record<string, [string, string]> = {};
  for (const [, ref, attributes, body] of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>(.*?)<\/c>/gs)) {
    if (/t="inlineStr"/.test(attributes)) cells[ref] = ['text', /<t[^>]*>(.*?)<\/t>/s.exec(body)?.[1] ?? ''];
    else cells[ref] = [/s="(\d+)"/.exec(attributes)?.[1] ?? 'general', /<v>(.*?)<\/v>/.exec(body)?.[1] ?? ''];
  }
  return cells;
}

/** The name of the first sheet of a workbook. */
export function xlsxSheetName(content: Buffer): string {
  const xml = new AdmZip(content).readAsText('xl/workbook.xml');
  return /<sheet name="([^"]*)"/.exec(xml)?.[1] ?? '';
}
