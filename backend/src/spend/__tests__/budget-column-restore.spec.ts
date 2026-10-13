import * as assert from 'node:assert/strict';
import { calculationShapes, uncheckedCalculationKeys } from '../budget-column-restore';

// The shapes a restored calculation may take (plan budget-tab-redesign, lot
// B2, review fix): read from the writers themselves, never written out. A
// key a writer gains is accepted by the restore at once; this spec then asks
// for its check, so nothing a report casts is ever stored unchecked.

function testEveryWrittenKeyHasACheck() {
  assert.deepEqual(uncheckedCalculationKeys(), [], 'a key a writer writes has no check in FIELDS or LINE_FIELDS');
}

function testShapesComeFromTheWriters() {
  const shapes = calculationShapes();
  const sorted = (keys: ReadonlySet<string>) => [...keys].sort();
  assert.deepEqual(sorted(shapes.annual.required), ['active_months', 'kind', 'profile', 'total', 'weights']);
  assert.deepEqual(sorted(shapes.annual.allowed), ['active_months', 'kind', 'lines_result', 'profile', 'source', 'total', 'weights'], 'an item CSV total and a spread over lines add theirs');
  assert.deepEqual(sorted(shapes.quarterly.required), ['active_months', 'distribution', 'kind', 'quarters']);
  assert.ok(shapes.quarterly.allowed.has('lines_result') && !shapes.quarterly.required.has('lines_result'));
  assert.deepEqual(
    sorted(shapes.copy.required),
    ['kind', 'source_measure', 'source_method', 'source_total', 'source_year', 'total', 'uplift_pct'],
  );
  assert.ok(shapes.copy.allowed.has('lines_result') && !shapes.copy.required.has('lines_result'), 'a copy of reference lines adds its result');
  assert.deepEqual(sorted(shapes.computed.allowed), ['active_months', 'fte', 'fte_months', 'fte_period', 'kind', 'lines', 'month_amounts', 'total']);
  assert.deepEqual(sorted(shapes.lines_result.allowed), sorted(shapes.computed.allowed).filter((key) => key !== 'kind'), 'a lines result is a computed calculation without its kind');
  for (const key of ['day_counts', 'total_days', 'month_amounts', 'fte_months', 'fte', 'fte_period', 'total', 'working_day_profile_code', 'quantity', 'period_start']) {
    assert.ok(shapes.line.allowed.has(key), `a line of a calculation holds ${key}`);
  }
}

function main() {
  testEveryWrittenKeyHasACheck();
  testShapesComeFromTheWriters();
  console.log('budget-column-restore.spec: ok');
}

main();
