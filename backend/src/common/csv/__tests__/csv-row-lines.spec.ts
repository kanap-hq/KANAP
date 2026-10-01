import * as assert from 'node:assert/strict';
import { parseString } from '@fast-csv/parse';
import { csvDataRowLines, rowLine } from '../csv-row-lines';

/**
 * The importers parse with `headers: true, ignoreEmpty: true`, which drops
 * blank lines: `csvDataRowLines` gives each emitted data row its physical line.
 */

function emittedRows(content: string): Promise<Array<Record<string, string>>> {
  return new Promise((resolve, reject) => {
    const rows: Array<Record<string, string>> = [];
    parseString(content, { headers: true, delimiter: ';', ignoreEmpty: true, trim: true })
      .on('error', reject)
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows));
  });
}

async function main() {
  const content = [
    '',                 // 1: blank before the header
    'name;notes',       // 2: header
    'a;one',            // 3
    '',                 // 4
    '   ',              // 5: spaces only
    ';',                // 6: separators only
    'b;"two\r\nlines"', // 7-8: a quoted cell on two lines
    'c;three',          // 9
    '',                 // 10
    'd;four',           // 11
  ].join('\n');
  const lines = await csvDataRowLines(content, ';');
  const rows = await emittedRows(content);
  assert.deepEqual(rows.map((r) => r.name), ['a', 'b', 'c', 'd'], 'what the importers see');
  assert.deepEqual(lines, [3, 7, 9, 11], 'one physical line per emitted row');

  assert.deepEqual(await csvDataRowLines('h;i\r\n1;2\r\n\r\n3;4\r\n', ';'), [2, 4], 'CRLF files');
  assert.deepEqual(await csvDataRowLines('h;i\n', ';'), [], 'header only');
  assert.deepEqual(await csvDataRowLines('﻿h;i\n1;2', ';'), [2], 'BOM, no final line break');
  assert.equal(rowLine([3, 7], 1), 7);
  assert.equal(rowLine([], 4), 6, 'unmapped: the former index + 2');
  console.log('csv-row-lines.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
