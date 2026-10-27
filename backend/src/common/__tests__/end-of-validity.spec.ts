import * as assert from 'node:assert/strict';
import {
  disabledAtWhere,
  endOfValidityFromDate,
  parseEndOfValidityInput,
  resolveEndOfValidityAlias,
} from '../status';

// A bare end-of-validity day is stored at 12:00 UTC so it reads the same
// calendar day (and year) from UTC-11 to UTC+11.

function testEndOfValidityFromDate() {
  assert.equal(endOfValidityFromDate('2026-12-31').toISOString(), '2026-12-31T12:00:00.000Z');
  assert.equal(endOfValidityFromDate(' 2028-02-29 ').toISOString(), '2028-02-29T12:00:00.000Z', 'leap day');
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2027-02-29', 'abc', '', '2026-1-01', '31/12/2026']) {
    assert.throws(() => endOfValidityFromDate(bad), /Invalid date/, `refuses ${JSON.stringify(bad)}`);
  }
}

function testParseEndOfValidityInput() {
  assert.equal(parseEndOfValidityInput('2026-06-30')?.toISOString(), '2026-06-30T12:00:00.000Z', 'bare date at noon UTC');
  assert.equal(parseEndOfValidityInput('2026-06-30T21:59:00.000Z')?.toISOString(), '2026-06-30T21:59:00.000Z', 'full timestamp kept');
  assert.equal(parseEndOfValidityInput('2026-06-30T23:59:00+02:00')?.toISOString(), '2026-06-30T21:59:00.000Z', 'offset timestamp kept as given');
  const date = new Date('2026-01-15T08:00:00.000Z');
  assert.equal(parseEndOfValidityInput(date)?.toISOString(), date.toISOString(), 'a Date is kept');
  assert.equal(parseEndOfValidityInput(''), null);
  assert.equal(parseEndOfValidityInput('   '), null);
  assert.equal(parseEndOfValidityInput(null), null);
  assert.equal(parseEndOfValidityInput(undefined), null);
  assert.throws(() => parseEndOfValidityInput('2026-02-30'), /Invalid date/);
  assert.throws(() => parseEndOfValidityInput('not a date'), /Invalid date/);
}

function testAlias() {
  // effective_end fills an empty end of validity...
  assert.equal((resolveEndOfValidityAlias(undefined, '2026-12-31') as Date).toISOString(), '2026-12-31T12:00:00.000Z');
  assert.equal((resolveEndOfValidityAlias(null, '2026-12-31') as Date).toISOString(), '2026-12-31T12:00:00.000Z');
  assert.equal((resolveEndOfValidityAlias('', '2026-12-31') as Date).toISOString(), '2026-12-31T12:00:00.000Z');
  // ...never overrides a given one...
  assert.equal((resolveEndOfValidityAlias('2027-03-01T10:00:00.000Z', '2026-12-31') as Date).toISOString(), '2027-03-01T10:00:00.000Z');
  // ...and a blank alias never clears or sets anything.
  assert.equal(resolveEndOfValidityAlias(undefined, null), undefined);
  assert.equal(resolveEndOfValidityAlias(undefined, ''), undefined);
  assert.equal(resolveEndOfValidityAlias(null, ''), null);
  assert.throws(() => resolveEndOfValidityAlias(undefined, '2026-02-30'), /^Error: effective_end: Invalid date/);
  // The alias takes a full timestamp too.
  assert.equal((resolveEndOfValidityAlias(undefined, '2026-12-31T00:00:00Z') as Date).toISOString(), '2026-12-31T00:00:00.000Z');
}

function testApiDisabledAt() {
  // disabled_at in an API body is parsed like a file or the AI: a bare day is noon UTC...
  assert.equal((resolveEndOfValidityAlias('2026-12-31', undefined) as Date).toISOString(), '2026-12-31T12:00:00.000Z');
  // ...a full timestamp is kept as given...
  assert.equal((resolveEndOfValidityAlias('2026-12-31T22:59:00.000Z', undefined) as Date).toISOString(), '2026-12-31T22:59:00.000Z');
  assert.equal((resolveEndOfValidityAlias('2026-12-31T23:59:00+01:00', undefined) as Date).toISOString(), '2026-12-31T22:59:00.000Z');
  // ...null still clears, and anything that is not a date is refused by name.
  assert.equal(resolveEndOfValidityAlias(null, undefined), null);
  assert.throws(() => resolveEndOfValidityAlias('someday', undefined), /^Error: disabled_at: Invalid date/);
  assert.throws(() => resolveEndOfValidityAlias('2026-02-30', undefined), /^Error: disabled_at: Invalid date/);
}

function sqlOf(operator: any): { sql: string; params: Record<string, unknown> } {
  return { sql: operator.getSql('"item"."disabled_at"'), params: operator.objectLiteralParameters ?? {} };
}

function testDisabledAtWhereCombinesScopeAndGridFilter() {
  assert.equal(disabledAtWhere(null), undefined, 'no scope, no filter: no condition');
  assert.equal(disabledAtWhere(null, { filterType: 'text', type: 'contains', filter: '2026' }), undefined, 'a text filter is ignored');

  const active = sqlOf(disabledAtWhere('active'));
  assert.equal(active.sql, '("item"."disabled_at" IS NULL OR "item"."disabled_at" > NOW())');

  const combined = sqlOf(disabledAtWhere('active', { filterType: 'date', type: 'lessThan', dateFrom: '2027-01-01 00:00:00' }));
  assert.equal(
    combined.sql,
    '("item"."disabled_at" IS NULL OR "item"."disabled_at" > NOW()) AND (CAST("item"."disabled_at" AS DATE) < CAST(:end_of_validity_0 AS DATE))',
  );
  assert.deepEqual(combined.params, { end_of_validity_0: '2027-01-01 00:00:00' });

  const since = new Date('2025-01-01T00:00:00.000Z');
  const summary = sqlOf(disabledAtWhere({ activeSince: since }, { filterType: 'date', type: 'blank' }));
  assert.equal(summary.sql, '("item"."disabled_at" IS NULL OR "item"."disabled_at" >= :period_start) AND ("item"."disabled_at" IS NULL)');
  assert.deepEqual(summary.params, { period_start: since });
}

function testDisabledAtWhereCombinedModels() {
  const and = sqlOf(disabledAtWhere('active', {
    filterType: 'date',
    operator: 'AND',
    conditions: [
      { filterType: 'date', type: 'greaterThan', dateFrom: '2026-01-01' },
      { filterType: 'date', type: 'lessThan', dateFrom: '2027-01-01' },
    ],
  }));
  assert.equal(
    and.sql,
    '("item"."disabled_at" IS NULL OR "item"."disabled_at" > NOW()) AND ((CAST("item"."disabled_at" AS DATE) > CAST(:end_of_validity_0 AS DATE)) AND (CAST("item"."disabled_at" AS DATE) < CAST(:end_of_validity_1 AS DATE)))',
    'both conditions of an AND model apply',
  );
  assert.deepEqual(and.params, { end_of_validity_0: '2026-01-01', end_of_validity_1: '2027-01-01' });

  const or = sqlOf(disabledAtWhere(null, {
    filterType: 'date',
    operator: 'OR',
    conditions: [
      { filterType: 'date', type: 'lessThan', dateFrom: '2026-01-01' },
      { filterType: 'date', type: 'greaterThan', dateFrom: '2027-01-01' },
    ],
  }));
  assert.equal(
    or.sql,
    '((CAST("item"."disabled_at" AS DATE) < CAST(:end_of_validity_0 AS DATE)) OR (CAST("item"."disabled_at" AS DATE) > CAST(:end_of_validity_1 AS DATE)))',
    'an OR model keeps its operator',
  );
}

function main() {
  testEndOfValidityFromDate();
  testParseEndOfValidityInput();
  testAlias();
  testApiDisabledAt();
  testDisabledAtWhereCombinesScopeAndGridFilter();
  testDisabledAtWhereCombinedModels();
  console.log('end-of-validity.spec: ok');
}

main();
