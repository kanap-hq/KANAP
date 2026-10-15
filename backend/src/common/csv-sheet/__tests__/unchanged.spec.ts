import * as assert from 'node:assert/strict';
import { StatusState } from '../../status';
import { sameStoredLifecycle, sameStoredValue, sameStoredValues } from '../unchanged';

// A re-imported row counts as unchanged when every value it sets equals the stored one,
// as the database returns it (numbers as strings for bigint and numeric, Dates for date
// and timestamp columns, objects for JSON).

function testValues() {
  // Blank and absent are the same stored value.
  assert.equal(sameStoredValue(null, ''), true);
  assert.equal(sameStoredValue(undefined, null), true);
  assert.equal(sameStoredValue('a', ''), false);
  // Numbers: bigint and numeric come back as strings.
  assert.equal(sameStoredValue('6156100', 6156100), true);
  assert.equal(sameStoredValue('12.50', 12.5), true);
  assert.equal(sameStoredValue('12.50', 12.51), false);
  assert.equal(sameStoredValue('0042', 42), true);
  assert.equal(sameStoredValue('abc', 0), false);
  // Text is compared as written: case counts for a name.
  assert.equal(sameStoredValue('Acme', 'acme'), false);
  // A date column comes back as a local midnight; a timestamp as an instant.
  assert.equal(sameStoredValue(new Date(2026, 8, 2), '2026-09-02'), true);
  assert.equal(sameStoredValue(new Date(2026, 8, 2), '2026-09-03'), false);
  assert.equal(sameStoredValue(new Date('2026-09-02T14:32:00Z'), new Date('2026-09-02T14:32:00Z')), true);
  assert.equal(sameStoredValue(new Date('2026-09-02T14:32:00Z'), '2026-09-02T14:32:00.000Z'), true);
  assert.equal(sameStoredValue(new Date('2026-09-02T14:32:00Z'), new Date('2026-09-02T14:33:00Z')), false);
  // Booleans, arrays and JSON.
  assert.equal(sameStoredValue(true, true), true);
  assert.equal(sameStoredValue(false, null), false);
  assert.equal(sameStoredValue(['a', 'b'], ['a', 'b']), true);
  assert.equal(sameStoredValue(['a', 'b'], ['b', 'a']), false);
  assert.equal(sameStoredValue(null, []), true);
  assert.equal(sameStoredValue({ a: 1, b: [2] }, { b: [2], a: 1 }), true);
  assert.equal(sameStoredValue({ a: 1 }, { a: 2 }), false);
}

function testRows() {
  const stored = { id: 'x', name: 'Acme', notes: null, amount: '10.00', updated_at: new Date() };
  // Only the values the row sets are compared; undefined means the row leaves it alone.
  assert.equal(sameStoredValues(stored, { name: 'Acme', notes: '', amount: 10, extra: undefined }), true);
  assert.equal(sameStoredValues(stored, { name: 'Acme', notes: 'new' }), false);
  // A value for a property the stored row does not have cannot be proven equal.
  assert.equal(sameStoredValues(stored, { name: 'Acme', related_object_name: 'Foo' }), false);
  // Restricted to some keys.
  assert.equal(sameStoredValues(stored, { name: 'Acme', notes: 'new' }, ['name']), true);
}

function testLifecycle() {
  const past = new Date('2020-06-30T12:00:00Z');
  // Nothing set keeps the stored lifecycle.
  assert.equal(sameStoredLifecycle({ disabled_at: past }, {}), true);
  // The status is read from the stored date.
  assert.equal(sameStoredLifecycle({ disabled_at: past }, { status: StatusState.DISABLED }), true);
  assert.equal(sameStoredLifecycle({ disabled_at: null }, { status: StatusState.ENABLED }), true);
  assert.equal(sameStoredLifecycle({ disabled_at: null }, { status: StatusState.DISABLED }), false);
  assert.equal(sameStoredLifecycle({ disabled_at: past }, { status: StatusState.DISABLED, disabled_at: past.toISOString() }), true);
  assert.equal(sameStoredLifecycle({ disabled_at: past }, { disabled_at: '2021-06-30T12:00:00.000Z' }), false);
}

testValues();
testRows();
testLifecycle();
console.log('unchanged.spec: ok');
