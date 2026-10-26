/**
 * Measure of the common xlsx writer on a budget-file sized workbook: 5,000 rows of 25 text columns,
 * 3 amount columns x 3 years x 12 months (108 amount cells) and 2 date columns.
 *
 * Run: `npx ts-node scripts/xlsx-write-bench.ts`. Prints the time to the buffer, the file size and the
 * resident memory before and after the write, and the peak reached during it. The write is synchronous,
 * so the peak is read from the kernel: `VmHWM` of `/proc/self/status`, reset just before the write
 * (Linux only; elsewhere it falls back to the process peak since start). Run with
 * `node --expose-gc -r ts-node/register/transpile-only scripts/xlsx-write-bench.ts` to start from a collected heap.
 */
import * as fs from 'node:fs';
import { writeXlsx, XlsxCell } from '../src/common/xlsx';

const ROWS = 5_000;
const TEXT_COLUMNS = 25;
const AMOUNT_COLUMNS = 3 * 3 * 12;
const DATE_COLUMNS = 2;

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const headers = [
  ...Array.from({ length: TEXT_COLUMNS }, (_, i) => `Text ${i + 1}`),
  ...Array.from({ length: AMOUNT_COLUMNS }, (_, i) => `Amount ${i + 1}`),
  ...Array.from({ length: DATE_COLUMNS }, (_, i) => `Date ${i + 1}`),
];

const rows: XlsxCell[][] = Array.from({ length: ROWS }, (_, r) => [
  ...Array.from({ length: TEXT_COLUMNS }, (_, c) => `Row ${r + 1} column ${c + 1} — café, <budget> & "notes"`),
  ...Array.from({ length: AMOUNT_COLUMNS }, (_, c): XlsxCell => ({ kind: 'amount', value: `${(r * 7 + c) % 2 ? '-' : ''}${(r + 1) * 100 + c}.${String((r + c) % 100).padStart(2, '0')}` })),
  ...Array.from({ length: DATE_COLUMNS }, (): XlsxCell => ({ kind: 'date', iso: `2026-${String((r % 12) + 1).padStart(2, '0')}-15` })),
]);

const peakKb = (): number | null => {
  try {
    const match = fs.readFileSync('/proc/self/status', 'utf8').match(/VmHWM:\s+(\d+) kB/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
};
const resetPeak = (): void => {
  try {
    fs.writeFileSync('/proc/self/clear_refs', '5');
  } catch {
    // not Linux, or not allowed: the peak then covers the whole run
  }
};

global.gc?.();
const before = process.memoryUsage().rss;
resetPeak();
const started = process.hrtime.bigint();
const buffer = writeXlsx({
  language: 'fr',
  sheets: [{ name: 'Budget', headers, rows, links: rows.map((_, r) => `/budget/${r + 1}`), linkColumn: 1 }],
  appBaseUrl: 'https://app.example.com',
});
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
const after = process.memoryUsage().rss;
const peak = peakKb();

console.log(`rows ${ROWS}, cells per row ${headers.length} (${TEXT_COLUMNS} text, ${AMOUNT_COLUMNS} amount, ${DATE_COLUMNS} date)`);
console.log(`time to buffer: ${(elapsedMs / 1000).toFixed(2)} s`);
console.log(`file size: ${mb(buffer.length)}`);
console.log(`rss before ${mb(before)}, after ${mb(after)}, peak during the write ${peak === null ? 'n/a' : mb(peak * 1024)}`);
if (peak !== null) console.log(`peak above the start: ${mb(peak * 1024 - before)}`);
