import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import {
  daysInMonth,
  isProfileActive,
  loadWorkingDayProfiles,
  loadWorkingDayProfilesByCode,
  mergeDaysByYear,
  normalizeDaysByYear,
} from '../working-day-profiles.util';

// Working-day calendar validation (decision D4): one helper for the API, the
// CSV and the computation. Pure, no database.

const SFR_2026 = ['18', '18', '20', '20', '15', '20', '15', '16', '20', '19', '18', '19'];

// Loosely typed on purpose: the refusals feed values of every type.
function months(overrides: Record<number, unknown> = {}): any[] {
  return SFR_2026.map((value, index) => (index + 1 in overrides ? overrides[index + 1] : value));
}

/** The call is refused with exactly this sentence, as a 400 carrying the field. */
function refused(run: () => unknown, message: string, where: { year?: string; month?: number } = {}) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof BadRequestException, 'a 400');
    assert.equal(error.message, message);
    const body = error.getResponse() as Record<string, unknown>;
    assert.equal(body.field, 'days_by_year');
    if (where.year !== undefined) assert.equal(body.year, where.year);
    if (where.month !== undefined) assert.equal(body.month, where.month);
    return true;
  });
}

function testDaysInMonth() {
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2000, 2), 29, '2000 is a leap year');
  assert.equal(daysInMonth(2100, 2), 28, '2100 is not');
  assert.equal(daysInMonth(2027, 4), 30);
  assert.equal(daysInMonth(2027, 12), 31);
}

function testAcceptsAndNormalises() {
  assert.deepEqual(normalizeDaysByYear({ 2026: SFR_2026 }), { 2026: SFR_2026 });
  const normalised = normalizeDaysByYear({
    '2027': ['18.000', '019.0833330', '0.50', 19.5, '19,5', '0', '00', '.5', '7.', ' 21 ', 16.75, '22.000000000'],
  });
  assert.deepEqual(normalised, {
    '2027': ['18', '19.083333', '0.5', '19.5', '19.5', '0', '0', '0.5', '7', '21', '16.75', '22'],
  });
  // Six decimals are kept exactly: 229 / 12 as a workbook stores it.
  assert.deepEqual(normalizeDaysByYear({ 2027: months({ 3: '19.083333' }) })['2027']![2], '19.083333');
  // Several years at once; an empty object is a calendar without years.
  assert.deepEqual(Object.keys(normalizeDaysByYear({ 2026: SFR_2026, 2027: SFR_2026 })), ['2026', '2027']);
  assert.deepEqual(normalizeDaysByYear({}), {});
}

function testLeapFebruary() {
  assert.equal(normalizeDaysByYear({ 2028: months({ 2: '29' }) })['2028']![1], '29');
  refused(() => normalizeDaysByYear({ 2027: months({ 2: '29' }) }), 'February 2027 has 28 days: enter 28 or less.', { year: '2027', month: 2 });
  refused(() => normalizeDaysByYear({ 2027: months({ 2: '28.5' }) }), 'February 2027 has 28 days: enter 28 or less.');
  refused(() => normalizeDaysByYear({ 2028: months({ 2: '29.000001' }) }), 'February 2028 has 29 days: enter 29 or less.');
}

function testMonthLimit() {
  assert.equal(normalizeDaysByYear({ 2027: months({ 3: 31 }) })['2027']![2], '31');
  refused(() => normalizeDaysByYear({ 2027: months({ 3: '32' }) }), 'March 2027 has 31 days: enter 31 or less.', { year: '2027', month: 3 });
  refused(() => normalizeDaysByYear({ 2027: months({ 3: '31.5' }) }), 'March 2027 has 31 days: enter 31 or less.');
  refused(() => normalizeDaysByYear({ 2027: months({ 4: '30.1' }) }), 'April 2027 has 30 days: enter 30 or less.');
  refused(() => normalizeDaysByYear({ 2027: months({ 5: '100000' }) }), 'May 2027 has 31 days: enter 31 or less.');
}

function testSixDecimals() {
  refused(() => normalizeDaysByYear({ 2027: months({ 1: '19.0833333' }) }), 'Use at most 6 decimals.', { year: '2027', month: 1 });
  refused(() => normalizeDaysByYear({ 2027: months({ 1: 0.1 + 0.2 }) }), 'Use at most 6 decimals.');
  // Trailing zeros are not decimals: the value is exact.
  assert.equal(normalizeDaysByYear({ 2027: months({ 1: '19.08333300' }) })['2027']![0], '19.083333');
}

function testMissingMonths() {
  const sentence = 'Enter the working days of all twelve months of 2027.';
  refused(() => normalizeDaysByYear({ 2027: SFR_2026.slice(0, 11) }), sentence, { year: '2027' });
  refused(() => normalizeDaysByYear({ 2027: [...SFR_2026, '18'] }), sentence);
  refused(() => normalizeDaysByYear({ 2027: months({ 6: '' }) }), sentence, { year: '2027', month: 6 });
  refused(() => normalizeDaysByYear({ 2027: months({ 6: '   ' }) }), sentence);
  refused(() => normalizeDaysByYear({ 2027: months({ 6: null }) }), sentence);
  refused(() => normalizeDaysByYear({ 2027: 'all of them' }), sentence);
  refused(() => normalizeDaysByYear({ 2027: null }), sentence, { year: '2027' });
}

function testBadValues() {
  refused(() => normalizeDaysByYear({ 2027: months({ 7: '-1' }) }), 'Enter 0 or more days for July 2027.', { month: 7 });
  refused(() => normalizeDaysByYear({ 2027: months({ 7: -0.5 }) }), 'Enter 0 or more days for July 2027.');
  refused(() => normalizeDaysByYear({ 2027: months({ 8: 'twenty' }) }), 'Enter a number of days for August 2027.', { month: 8 });
  refused(() => normalizeDaysByYear({ 2027: months({ 8: '1e1' }) }), 'Enter a number of days for August 2027.');
  refused(() => normalizeDaysByYear({ 2027: months({ 8: '.' }) }), 'Enter a number of days for August 2027.');
  refused(() => normalizeDaysByYear({ 2027: months({ 8: Number.NaN }) }), 'Enter a number of days for August 2027.');
  refused(() => normalizeDaysByYear({ 2027: months({ 8: true }) }), 'Enter a number of days for August 2027.');
  refused(() => normalizeDaysByYear({ 2027: months({ 8: '1.000.5' }) }), 'Enter a number of days for August 2027.');
}

function testYearRange() {
  assert.deepEqual(Object.keys(normalizeDaysByYear({ 2000: SFR_2026, 2100: SFR_2026 })), ['2000', '2100']);
  refused(() => normalizeDaysByYear({ 1999: SFR_2026 }), '1999 is not a year between 2000 and 2100.', { year: '1999' });
  refused(() => normalizeDaysByYear({ 2101: SFR_2026 }), '2101 is not a year between 2000 and 2100.');
  refused(() => normalizeDaysByYear({ '20261': SFR_2026 }), '20261 is not a year between 2000 and 2100.');
  refused(() => normalizeDaysByYear({ '26': SFR_2026 }), '26 is not a year between 2000 and 2100.');
  refused(() => normalizeDaysByYear({ next: SFR_2026 }), 'next is not a year between 2000 and 2100.');
  refused(() => normalizeDaysByYear({ '2026': SFR_2026, ' 2026': SFR_2026 }), '2026 is given twice.');
}

function testShape() {
  for (const raw of [null, undefined, [], [SFR_2026], 'x', 12]) {
    refused(() => normalizeDaysByYear(raw), 'Give the working days per year.');
  }
}

function testPartialAndMerge() {
  // A PATCH: a year set to null is a removal, kept as null for the merge.
  const patch = normalizeDaysByYear({ 2026: null, 2027: months({ 1: '17' }) }, { partial: true });
  assert.deepEqual(patch, { 2026: null, 2027: months({ 1: '17' }) });

  const stored = { 2025: SFR_2026, 2026: SFR_2026 };
  const merged = mergeDaysByYear(stored, patch);
  assert.deepEqual(merged, { 2025: SFR_2026, 2027: months({ 1: '17' }) }, '2025 kept, 2026 removed, 2027 added');
  assert.deepEqual(Object.keys(merged), ['2025', '2027']);
  assert.deepEqual(stored, { 2025: SFR_2026, 2026: SFR_2026 }, 'the stored value is not mutated');

  // A year sent replaces that year only; removing an absent year changes nothing.
  assert.deepEqual(mergeDaysByYear(stored, { 2026: months({ 12: '0' }) }), { 2025: SFR_2026, 2026: months({ 12: '0' }) });
  assert.deepEqual(mergeDaysByYear(stored, { 2030: null }), stored);
  assert.deepEqual(mergeDaysByYear(null, { 2026: SFR_2026 }), { 2026: SFR_2026 });
  assert.deepEqual(mergeDaysByYear(stored, {}), stored);
}

function testIsProfileActive() {
  const now = new Date('2026-09-28T12:00:00Z');
  assert.equal(isProfileActive({ status: 'enabled', disabled_at: null }, now), true);
  assert.equal(isProfileActive({ status: 'disabled', disabled_at: null }, now), false);
  assert.equal(isProfileActive({ status: 'disabled', disabled_at: '2026-09-01T12:00:00Z' }, now), false);
  // The end of validity decides once set: the stored status may lag behind it.
  assert.equal(isProfileActive({ status: 'enabled', disabled_at: '2026-09-01T12:00:00Z' }, now), false);
  assert.equal(isProfileActive({ status: 'enabled', disabled_at: new Date('2026-12-31T12:00:00Z') }, now), true);
  assert.equal(isProfileActive({ status: 'enabled', disabled_at: now }, now), false);
}

async function testLoaderLock() {
  // The SQL each loader sends, on a recording double (the lock itself is proven on the
  // database by the tenant-isolation spec).
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const recorder = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return []; } };
  const id = '6f1c2b7e-0d4a-4c1e-9a55-2d3b8f1e7a90';
  await loadWorkingDayProfiles(recorder, 'tenant-a', [id, id]);
  await loadWorkingDayProfiles(recorder, 'tenant-a', [id], { lock: 'key share' });
  await loadWorkingDayProfilesByCode(recorder, 'tenant-a', [' FR218 ', 'fr218']);
  await loadWorkingDayProfilesByCode(recorder, 'tenant-a', ['FR218'], { lock: 'key share' });
  // Nothing to load: no query, locked or not.
  await loadWorkingDayProfiles(recorder, 'tenant-a', ['not-a-uuid'], { lock: 'key share' });
  await loadWorkingDayProfilesByCode(recorder, 'tenant-a', ['  '], { lock: 'key share' });

  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.match(call.sql, /FROM working_day_profiles w WHERE w\.tenant_id = \$1 AND /, 'the tenant predicate stays');
    assert.equal(call.params[0], 'tenant-a');
  }
  assert.deepEqual(calls.map((call) => call.params[1]), [[id], [id], ['fr218'], ['fr218']]);
  for (const unlocked of [calls[0], calls[2]]) assert.doesNotMatch(unlocked.sql, /\bFOR (KEY SHARE|SHARE|NO KEY UPDATE|UPDATE)\b/);
  for (const locked of [calls[1], calls[3]]) assert.match(locked.sql, / ORDER BY w\.id FOR KEY SHARE OF w$/);
}

async function main() {
  testDaysInMonth();
  testAcceptsAndNormalises();
  testLeapFebruary();
  testMonthLimit();
  testSixDecimals();
  testMissingMonths();
  testBadValues();
  testYearRange();
  testShape();
  testPartialAndMerge();
  testIsProfileActive();
  await testLoaderLock();
  console.log('working-day-profiles.util.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
