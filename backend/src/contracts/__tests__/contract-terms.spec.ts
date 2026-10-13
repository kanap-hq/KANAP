import * as assert from 'node:assert/strict';
import {
  CONTRACT_DECISION_WINDOW_DAYS,
  addMonthsYmd,
  computeContractTerms,
  contractCommitment,
  contractCommitmentCents,
  contractCommitmentSql,
  contractTermFields,
  contractTermsSql,
  sqlDateLiteral,
  turnsOffRenewalOfRenewedContract,
} from '../contract-terms';
import * as Front from '../../../../frontend/src/pages/contracts/contractTerms';
import { CONTRACT_COMMITMENT_CASES, CONTRACT_CONFIRMED_RENEWAL_CASES, CONTRACT_TERM_CASES, contractTermSweep } from './contract-terms.cases';

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

// A confirmed renewal (lot CR2): only the term of the next deadline counts.
for (const c of CONTRACT_CONFIRMED_RENEWAL_CASES) {
  const input = { start_date: c.start, duration_months: c.months, notice_period_months: c.notice, auto_renewal: c.renewal, disabled_at: c.disabledAt ?? null };
  const asked: string[] = [];
  const terms = computeContractTerms(input, c.today, { renewalConfirmed: (termEnd) => { asked.push(termEnd); return termEnd === c.confirmedTermEnd; } });
  assert.equal(terms.term_state, c.expected, `confirmed renewal: ${c.name}`);
  // Without a decision, the state is the one of the rule without the option.
  if (c.confirmedTermEnd === null) assert.equal(computeContractTerms(input, c.today).term_state, c.expected, `${c.name}: no option`);
  assert.ok(asked.length <= 1, `${c.name}: one term asked at most`);
}
assert.doesNotMatch(contractTermsSql('c', 'CURRENT_DATE').termState, /ct_x\.next_k \+ 1/, 'no confirmed renewal asked: the SQL reads no decision');
assert.match(contractTermsSql('c', 'CURRENT_DATE', { renewalConfirmed: (termEnd) => `confirmed(${termEnd})` }).termState, /AND NOT COALESCE\(confirmed\(/);

// An edit that turns off the renewal of a contract already renewed (lot CR2).
const sap = { start_date: '2023-07-01', duration_months: 12, notice_period_months: 6, auto_renewal: true };
assert.equal(turnsOffRenewalOfRenewedContract(sap, { ...sap, auto_renewal: false }, '2026-10-13'), true, 'SAP, fourth term: refused');
assert.equal(turnsOffRenewalOfRenewedContract(sap, { ...sap, auto_renewal: null }, '2026-10-13'), true, 'null counts as off');
assert.equal(turnsOffRenewalOfRenewedContract(sap, { ...sap, auto_renewal: false }, '2024-01-15'), false, 'still in its first term: allowed');
assert.equal(turnsOffRenewalOfRenewedContract(sap, { ...sap, start_date: '2026-01-01', auto_renewal: false }, '2026-10-13'), false, 'the same edit moves the start into the first term: allowed');
assert.equal(turnsOffRenewalOfRenewedContract(sap, { ...sap, auto_renewal: false, disabled_at: '2024-05-31T12:00:00.000Z' }, '2026-10-13'), false, 'ended in its first term: allowed');
assert.equal(turnsOffRenewalOfRenewedContract({ ...sap, auto_renewal: false }, { ...sap, auto_renewal: false }, '2026-10-13'), false, 'already off: not this edit');
assert.equal(turnsOffRenewalOfRenewedContract(sap, sap, '2026-10-13'), false, 'renewal kept');

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

// The commitment of a year (lot CB): the hand-worked cases.
for (const c of CONTRACT_COMMITMENT_CASES) {
  const input = { start_date: c.start, duration_months: c.months, auto_renewal: c.renewal, disabled_at: c.disabledAt ?? null, yearly_amount_at_signature: c.amount };
  assert.equal(contractCommitment(input, c.year), c.expected, `commitment: ${c.name}`);
}
// A contract that starts on the 15th and does not renew commits its yearly amount over its two years, to the cent.
const fromThe15th = { start_date: '2026-03-15', duration_months: 12, auto_renewal: false, yearly_amount_at_signature: 120000 };
assert.equal(contractCommitmentCents(fromThe15th, 2026) + contractCommitmentCents(fromThe15th, 2027), 12_000_000n, 'the two years add up');
// Raw query inputs: a Date at local midnight for the start, a string amount.
assert.equal(contractCommitment({ start_date: new Date(2023, 6, 1), duration_months: 12, auto_renewal: true, yearly_amount_at_signature: '350000.00' }, 2027), 350000, 'Date and string inputs');
assert.throws(() => contractCommitmentCents(fromThe15th, 2026.5), /Invalid year/);
assert.throws(() => contractCommitmentSql('c; DROP', '2026'), /Invalid table alias/);

console.log(`contract-terms.spec: ok (${CONTRACT_TERM_CASES.length} cases, ${compared} sweep rows, ${CONTRACT_COMMITMENT_CASES.length} commitment cases)`);
