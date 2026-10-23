// The server's zone is set before anything reads a date: Paris is east of UTC, where
// `toISOString` gave the day before for a `date` column read by the database driver.
process.env.TZ = 'Europe/Paris';

import * as assert from 'node:assert/strict';
import { applicationDayOf, assertApplicationDates } from '../application-rules';

// Recette C1a: the go-live, end of support and retirement days compare as days, whatever the
// zone of the server and whatever form the value arrives in.

function testStoredDatesKeepTheirDay() {
  assert.equal(new Date(2026, 4, 1).getTimezoneOffset(), -120, 'the spec runs in Paris time');
  // What `SELECT *` returns for a `date` column: midnight in the server's zone.
  assert.equal(applicationDayOf(new Date(2026, 4, 1)), '2026-05-01');
  assert.equal(applicationDayOf(new Date(2026, 0, 1)), '2026-01-01');
  // What the API makes of a day it receives: midnight UTC.
  assert.equal(applicationDayOf(new Date('2026-05-01')), '2026-05-01');
  assert.equal(applicationDayOf('2026-05-01'), '2026-05-01');
  assert.equal(applicationDayOf('2026-05-01T00:00:00.000Z'), '2026-05-01');
  assert.equal(applicationDayOf(''), null);
  assert.equal(applicationDayOf('not a date'), null);
}

function testSameDayIsConsistent() {
  // A stored go-live and an end of support on the same day: accepted.
  assertApplicationDates({ go_live_date: new Date(2026, 4, 1), end_of_support_date: '2026-05-01' });
  assertApplicationDates({ go_live_date: '2026-05-01', retired_date: new Date(2026, 4, 1) });
  assertApplicationDates({ go_live_date: new Date('2026-05-01'), end_of_support_date: new Date(2026, 4, 1) });
  assert.throws(() => assertApplicationDates({ go_live_date: new Date(2026, 4, 2), end_of_support_date: '2026-05-01' }), /end_of_support_date/);
}

testStoredDatesKeepTheirDay();
testSameDayIsConsistent();
console.log('application-days.spec: ok');
