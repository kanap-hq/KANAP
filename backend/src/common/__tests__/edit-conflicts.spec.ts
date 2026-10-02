import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { EDIT_CONFLICT_CODE, EditConflictException, conflictingFields, sameFieldValue, splitEditBase } from '../edit-conflicts';

// The comparison and the body contract of the field-level edit conflicts
// (plan planning/perf-scale, lot 3C). The races, the audit lookup and the
// HTTP answer on real data are in spend/__tests__/item-edit-conflict-races.ts.

function testEmptyValues() {
  assert.ok(sameFieldValue(null, undefined), 'null and undefined');
  assert.ok(sameFieldValue(null, ''), 'a stored null and a blank text sent by a form');
  assert.ok(sameFieldValue('  ', null), 'whitespace only is empty');
  assert.ok(!sameFieldValue(null, 'x'));
  assert.ok(!sameFieldValue(0, null), 'zero is a value');
  assert.ok(!sameFieldValue(false, null), 'false is a value');
}

function testTexts() {
  assert.ok(sameFieldValue('Notes', ' Notes '), 'compared trimmed');
  assert.ok(!sameFieldValue('Notes', 'notes'), 'texts keep their case');
  assert.ok(!sameFieldValue('7', '007'), 'two numeric texts compare as texts (a text column)');
}

function testNumbers() {
  assert.ok(sameFieldValue('12.50', 12.5), 'a numeric column read as text and a JSON number');
  assert.ok(sameFieldValue(7, '7'));
  assert.ok(sameFieldValue(1, '1.0'));
  assert.ok(sameFieldValue(BigInt(3), 3));
  assert.ok(!sameFieldValue(12.5, '12.51'));
  assert.ok(!sameFieldValue(1, 'one'));
  assert.ok(!sameFieldValue(Number.NaN, Number.NaN), 'not a number equals nothing');
}

function testDates() {
  const stored = new Date('2026-10-02T12:02:00.000Z');
  assert.ok(sameFieldValue(stored, '2026-10-02T12:02:00.000Z'), 'a timestamptz and its JSON');
  assert.ok(sameFieldValue(stored, '2026-10-02T14:02:00+02:00'), 'the same instant in another offset');
  assert.ok(sameFieldValue('2026-10-02T12:02:00Z', '2026-10-02T14:02:00.000+02:00'), 'two ISO timestamps as instants');
  assert.ok(!sameFieldValue(stored, '2026-10-02T12:03:00.000Z'));
  assert.ok(!sameFieldValue(stored, 'not a date'));
  assert.ok(sameFieldValue('2026-01-01', '2026-01-01'), 'a date column read as text');
  assert.ok(!sameFieldValue('2026-01-01', '2026-01-02'));
  assert.ok(!sameFieldValue(new Date('invalid'), stored), 'an invalid date is empty');
}

function testIdsAndOthers() {
  const id = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  assert.ok(sameFieldValue(id, id.toUpperCase()), 'uuids without case');
  assert.ok(!sameFieldValue(id, '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4c'));
  assert.ok(sameFieldValue(true, 'true'));
  assert.ok(!sameFieldValue(true, false));
  assert.ok(sameFieldValue({ b: 1, a: [1, 2] }, { a: [1, 2], b: 1 }), 'objects whatever their key order');
  assert.ok(!sameFieldValue({ a: [1, 2] }, { a: [2, 1] }), 'arrays keep their order');
}

function testConflictingFields() {
  const field = (base: unknown, current: unknown, mine: unknown) => ({ field: 'notes', base, current, mine, auditPath: ['notes'] });
  assert.equal(conflictingFields([field('a', 'a', 'b')]).length, 0, 'nobody changed it');
  assert.equal(conflictingFields([field('a', 'c', 'b')]).length, 1, 'someone else changed it');
  assert.equal(conflictingFields([field('a', 'b', 'b')]).length, 0, 'someone else made the same change');
  assert.equal(conflictingFields([field(null, '', 'b')]).length, 0, 'empty either way');
}

function testSplitBase() {
  const { changes, base } = splitEditBase({ notes: 'x', base: { notes: 'y' } });
  assert.deepEqual(changes, { notes: 'x' });
  assert.deepEqual(base, { notes: 'y' });
  assert.deepEqual(splitEditBase({ notes: 'x' }), { changes: { notes: 'x' }, base: null }, 'no base: as before');
  assert.deepEqual(splitEditBase({ notes: 'x', base: null }).base, null);
  assert.deepEqual(splitEditBase(undefined), { changes: {}, base: null });
  assert.throws(() => splitEditBase({ notes: 'x', base: 'y' }), BadRequestException);
  assert.throws(() => splitEditBase({ notes: 'x', base: ['y'] }), BadRequestException);
}

function testAnswer() {
  const error = new EditConflictException([{
    field: 'notes', base: 'a', current: 'c', mine: 'b',
    labels: { base: null, current: null, mine: null },
    changed_by: { id: 'u', name: 'Marie Dupont' }, changed_at: '2026-10-02T12:02:00.000Z',
  }], 4);
  assert.equal(error.getStatus(), 409);
  const body = error.getResponse() as Record<string, any>;
  assert.equal(body.code, EDIT_CONFLICT_CODE);
  assert.equal(body.row_version, 4);
  assert.equal(body.conflicts[0].changed_by.name, 'Marie Dupont');
}

function main() {
  testEmptyValues();
  testTexts();
  testNumbers();
  testDates();
  testIdsAndOthers();
  testConflictingFields();
  testSplitBase();
  testAnswer();
  console.log('edit-conflicts.spec: ok');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
