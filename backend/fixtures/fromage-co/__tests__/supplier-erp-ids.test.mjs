// The ERP supplier IDs of the sample data are the ones of an ERP (`F10001`), the same in the four
// languages and in the import example. They never read as a Kadratis reference (`SUP-n`), which a
// supplier carries as its own.
//
//   node --test backend/fixtures/fromage-co/__tests__/supplier-erp-ids.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../../../scripts/lib/fixture-csv.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const idsOf = (folder) => parseCsv(readFileSync(path.join(DIR, folder, '07-suppliers.csv'), 'utf8')).map((row) => row.erp_supplier_id);

const english = idsOf('.');

test('every supplier has a distinct ERP ID of the form F1 and four digits', () => {
  assert.equal(english.length, 42);
  for (const id of english) assert.match(id, /^F10\d{3}$/);
  assert.equal(new Set(english).size, english.length);
});

test('no ERP ID looks like a Kadratis reference', () => {
  for (const folder of ['.', 'fr', 'de', 'es']) {
    for (const id of idsOf(folder)) assert.doesNotMatch(id, /^[A-Z]+-\d+$/, `${folder}: ${id}`);
  }
});

test('the four languages hold the same ERP IDs in the same order', () => {
  for (const folder of ['fr', 'de', 'es']) assert.deepEqual(idsOf(folder), english, folder);
});

test('the supplier import example uses ERP-style IDs too', () => {
  const example = JSON.parse(readFileSync(path.join(DIR, '..', 'import-examples', 'suppliers.json'), 'utf8'));
  assert.ok(example.rows.length > 0);
  for (const row of example.rows) assert.match(row.erp_supplier_id, /^F10\d{3}$/);
});
