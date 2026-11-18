import * as assert from 'node:assert/strict';
import { readImportCell } from '../clear';

/**
 * The one reading of an import cell (D21 of 26.11.9): blank keeps, `-` clears (also written
 * `__CLEAR__` by older files, and ` - ` by Excel's accounting format), anything else is a value,
 * a value holding a dash included.
 */

for (const raw of [undefined, null, '', '   ', ' ']) {
  assert.deepEqual(readImportCell(raw), { kind: 'blank' }, JSON.stringify(raw));
}
for (const raw of ['-', ' - ', ' - ', '__CLEAR__', ' __CLEAR__ ']) {
  assert.deepEqual(readImportCell(raw), { kind: 'clear' }, JSON.stringify(raw));
}
for (const [raw, text] of [
  ['Acme', 'Acme'],
  ['  Acme  ', 'Acme'],
  ['Jean-Pierre', 'Jean-Pierre'],
  ['-5', '-5'],
  ['--', '--'],
  ['- x', '- x'],
  ['__clear__', '__clear__'],
] as const) {
  assert.deepEqual(readImportCell(raw), { kind: 'value', text }, raw);
}
console.log('csv-sheet clear: OK');
