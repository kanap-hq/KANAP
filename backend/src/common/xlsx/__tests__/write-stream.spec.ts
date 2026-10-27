import * as assert from 'node:assert/strict';
import { readXlsxGrid } from '../read';
import { writeTextXlsxStream, writeXlsx } from '../write';

/**
 * The streamed text sheet: the same bytes as the common writer for one styled sheet of inline strings
 * (headers, widths, filter, styles, archive entries), with the rows read from an async iterator, so a
 * 100,000-row export never holds its rows as one array.
 */

function rowsOf(count: number): string[][] {
  const rows: string[][] = [];
  for (let index = 0; index < count; index += 1) {
    rows.push([
      `2026-10-01T12:00:00.${String(index % 1000).padStart(3, '0')}Z`,
      index % 3 === 0 ? 'export' : 'update',
      `name & <tag> "quoted" ${index}`,
      index % 5 === 0 ? "'=SUM(A1)" : index % 7 === 0 ? '_x0041_ literal' : `Supplier ${index}`,
      index % 11 === 0 ? 'é ü 中 😀' : '',
      index % 13 === 0 ? '  spaced  ' : `SUP-${index}`,
    ]);
  }
  return rows;
}

async function compareWithWriter(rows: readonly (readonly string[])[], sheetName: string, label: string): Promise<void> {
  const headers = ['date', 'action', 'name', 'code', 'note', 'ref'];
  const modifiedAt = new Date('2026-01-02T03:04:06Z');
  const reference = writeXlsx({
    language: 'fr',
    modifiedAt,
    sheets: [{ name: sheetName, headers, rows, header: 'styled' }],
  });
  async function* streamedRows(): AsyncGenerator<readonly (string | null | undefined)[]> {
    for (const row of rows) yield row;
  }
  const streamed = await writeTextXlsxStream({
    language: 'fr',
    sheetName,
    headers,
    rows: streamedRows(),
    rowCount: rows.length,
    modifiedAt,
  });
  assert.ok(streamed.equals(reference), `${label}: byte for byte the common writer's file`);
  assert.deepEqual(readXlsxGrid(streamed), readXlsxGrid(reference), `${label}: the same grid`);
  // The same date, the same workbook: the archive is reproducible.
  const again = await writeTextXlsxStream({
    language: 'fr',
    sheetName,
    headers,
    rows: (async function* () {
      for (const row of rows) yield row;
    })(),
    rowCount: rows.length,
    modifiedAt,
  });
  assert.ok(again.equals(streamed), `${label}: the same bytes on a second run`);
}

async function main(): Promise<void> {
  // Past the 1,000-row width sample: a longer text later must not change the columns.
  await compareWithWriter(rowsOf(2_500), 'Audit log', '2,500 rows');
  await compareWithWriter(rowsOf(0), 'Audit log', 'no row');
  await compareWithWriter(rowsOf(5), "Audit 'log' []:*?/\\ 2026", 'a sheet name to sanitise');

  // A cell that is not text: the audit export never has one, and the stream says so.
  await assert.rejects(
    () =>
      writeTextXlsxStream({
        language: 'en',
        sheetName: 'Data',
        headers: ['a'],
        rows: (async function* () {
          yield [{ kind: 'number', value: 1 } as unknown as string];
        })(),
        rowCount: 1,
      }),
    /text only/,
  );

  // The count written in the filter range and the number of rows read must agree.
  await assert.rejects(
    () =>
      writeTextXlsxStream({
        language: 'en',
        sheetName: 'Data',
        headers: ['a'],
        rows: (async function* () {
          yield ['one'];
          yield ['two'];
        })(),
        rowCount: 1,
      }),
    /declared count/,
  );

  console.log('write-stream.spec.ts: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
