import * as assert from 'node:assert/strict';
import {
  CONTRACT_DECISION_WINDOW_DAYS,
  addMonthsYmd,
  computeContractTerms,
  contractTermFields,
  contractTermsSql,
  sqlDateLiteral,
} from '../contract-terms';
import * as Front from '../../../../frontend/src/pages/contracts/contractTerms';
import { CONTRACT_TERM_CASES, contractTermSweep } from './contract-terms.cases';

// The contract term rule in TypeScript (contracts/contract-terms.ts): the hand-worked cases,
// month arithmetic, and the frontend copy (frontend/src/pages/contracts/contractTerms.ts,
// imported here) on every combination of the sweep. The SQL side is checked against the
// database by contract-terms.parity.spec.ts.

// Months keep the day of the month, brought back to the month's last day (PostgreSQL's rule).
assert.equal(addMonthsYmd('2025-01-31', 1), '2025-02-28', '31 January + 1 month');
assert.equal(addMonthsYmd('2024-01-31', 1), '2024-02-29', '31 January + 1 month, leap year');
assert.equal(addMonthsYmd('2026-03-31', 1), '2026-04-30', '31 March + 1 month');
assert.equal(addMonthsYmd('2026-12-31', -3), '2026-09-30', '31 December - 3 months');
assert.equal(addMonthsYmd('2027-05-31', -3), '2027-02-28', '31 May - 3 months');
assert.equal(addMonthsYmd('2026-12-31', -1), '2026-11-30', '31 December - 1 month');
assert.equal(addMonthsYmd('2024-02-29', 12), '2025-02-28', '29 February + 12 months');
assert.equal(addMonthsYmd('2026-01-15', -13), '2024-12-15', 'back across a year');
assert.equal(addMonthsYmd('2026-01-15', 0), '2026-01-15', 'zero months');

for (const c of CONTRACT_TERM_CASES) {
  const got = computeContractTerms(
    { start_date: c.start, duration_months: c.months, notice_period_months: c.notice, auto_renewal: c.renewal, disabled_at: c.disabledAt ?? null },
    c.today,
  );
  assert.deepEqual(
    {
      term_index: got.term_index,
      current_term_end: got.current_term_end,
      next_cancellation_deadline: got.next_cancellation_deadline,
      cancellation_deadline: got.cancellation_deadline,
      renews_at_term_end: got.renews_at_term_end,
      next_due_date: got.next_due_date,
      term_state: got.term_state,
    },
    c.expected,
    c.name,
  );
  assert.equal(got.renewed, c.expected.term_index > 0, `${c.name}: renewed`);
  assert.equal(got.end_date, got.current_term_end, `${c.name}: end_date is the current term end`);
}

// A date column read by a raw query is a Date at local midnight; an end of validity a Date.
const fromDates = computeContractTerms(
  { start_date: new Date(2023, 6, 1), duration_months: 12, notice_period_months: 3, auto_renewal: true, disabled_at: new Date('2027-01-01T12:00:00Z') },
  '2026-10-12',
);
assert.equal(fromDates.current_term_end, '2027-06-30', 'Date inputs');
assert.equal(fromDates.term_index, 3);

// The response fields leave the internal flag out.
const fields = contractTermFields({ start_date: '2023-07-01', duration_months: 12, notice_period_months: 3, auto_renewal: true }, '2026-10-12');
assert.deepEqual(Object.keys(fields).sort(), [
  'cancellation_deadline', 'current_term_end', 'end_date', 'next_cancellation_deadline', 'next_due_date', 'renewed', 'term_index', 'term_state',
]);

// The decision window: 90 days by default, narrower when given.
assert.equal(CONTRACT_DECISION_WINDOW_DAYS, 90);
const deadlineIn49Days = { start_date: '2025-01-01', duration_months: 12, notice_period_months: 1, auto_renewal: true };
assert.equal(computeContractTerms(deadlineIn49Days, '2026-10-12').term_state, 'to_decide', 'deadline 30 November, 90-day window');
assert.equal(computeContractTerms(deadlineIn49Days, '2026-10-12', { decisionWindowDays: 30 }).term_state, 'in_progress', '30-day window');
assert.equal(computeContractTerms(deadlineIn49Days, '2026-10-12', { decisionWindowDays: 49 }).term_state, 'to_decide', 'window ending on the deadline');
assert.throws(() => computeContractTerms(deadlineIn49Days, '2026-10-12', { decisionWindowDays: 1.5 }), /Invalid decision window/);
assert.throws(() => contractTermsSql('c', 'CURRENT_DATE', { decisionWindowDays: -1 }), /Invalid decision window/);
assert.match(contractTermsSql('c', 'CURRENT_DATE', { decisionWindowDays: 30 }).termState, /ct_b\.today \+ 30 THEN 'to_decide'/);

// The SQL builder takes trusted pieces only.
assert.equal(sqlDateLiteral('2026-10-12'), `DATE '2026-10-12'`);
assert.throws(() => sqlDateLiteral(`2026-10-12'; --`), /Invalid calendar date/);
assert.throws(() => sqlDateLiteral('2026-02-30'), /Invalid calendar date/);
assert.throws(() => contractTermsSql('c; DROP', 'CURRENT_DATE'), /Invalid table alias/);

// The frontend copy agrees with the backend rule everywhere.
let compared = 0;
for (const row of contractTermSweep()) {
  const input = { start_date: row.start, duration_months: row.months, notice_period_months: row.notice, auto_renewal: row.renewal, disabled_at: row.disabledAt };
  const back = computeContractTerms(input, row.today);
  const front = Front.computeContractTerms(input, row.today);
  assert.deepEqual(
    front,
    {
      term_index: back.term_index,
      renewed: back.renewed,
      current_term_end: back.current_term_end,
      next_cancellation_deadline: back.next_cancellation_deadline,
      cancellation_deadline: back.cancellation_deadline,
    },
    `frontend copy: ${JSON.stringify(row)}`,
  );
  compared += 1;
}
assert.ok(compared > 40000, 'the whole sweep is compared');

console.log(`contract-terms.spec: ok (${CONTRACT_TERM_CASES.length} cases, ${compared} sweep rows)`);
